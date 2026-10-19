<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * İYS kuyruğunu siparişlerden doldurur (pazaryerleri HARİÇ — yalnız site + mobil app).
 *
 * Kişi tekilleştirme:
 *  - Telefonlu kişiler: normalize mobil (905XXXXXXXXX) bazında; ilk sipariş tarihi/adı alınır,
 *    kişinin en erken geçerli e-postası eklenir. Aynı e-posta birden çok numarada görünürse
 *    yalnız en eski sipariş tarihli kişide kalır (EPOSTA mükerrer gitmesin).
 *  - Telefonsuz ama e-postalı kişiler ayrıca eklenir.
 *
 * Idempotent: yeniden çalıştırılırsa yalnız kuyrukta olmayan yeni kişiler eklenir
 * (partial unique index + on conflict do nothing).
 *
 * --members: kayıtlı üye tabanını da ekler (customers, platform_type=ticimax).
 * Üyelerde first_order_at NULL kalır; dispatcher first_order_at ASC sıraladığı ve
 * Postgres NULL'ları sona koyduğu için üyeler DAİMA siparişlilerden SONRA işlenir.
 */
class IysSeedContacts extends Command
{
    protected $signature = 'iys:seed {--tenant=1} {--members : Üye tabanını da ekle (sipariş tarihi boş → kuyruğun sonuna)}';

    protected $description = 'İYS aktarım kuyruğunu site+app siparişlerinden doldurur (tekil kişi, ilk sipariş sırasıyla)';

    private const SOURCES = "('TicimaxWeb','NativeAndroid','NativeIOS')";
    private const TEL_RE = "'^(90|0)?5[0-9]{9}$'";
    private const EMAIL_RE = "'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'";

    public function handle(): int
    {
        $t = (int) $this->option('tenant');
        $before = DB::table('iys_contacts')->where('tenant_id', $t)->count();

        $telRe = self::TEL_RE;
        $emailRe = self::EMAIL_RE;
        $sources = self::SOURCES;

        $sql = <<<SQL
insert into iys_contacts (tenant_id, phone, email, name, first_order_at, first_order_no, order_source, status, created_at, updated_at)
with o as (
  select
    case when regexp_replace(coalesce(billing_address->>'phone',''),'[^0-9]','','g') ~ {$telRe}
         then '90' || right(regexp_replace(billing_address->>'phone','[^0-9]','','g'), 10) end as tel,
    case when customer_email ~ {$emailRe} then lower(customer_email) end as em,
    customer_name, order_no, order_date, order_source
  from orders
  where tenant_id = {$t} and order_source in {$sources}
),
tel_base as (
  select distinct on (tel) tel, customer_name, order_no, order_date, order_source
  from o where tel is not null
  order by tel, order_date asc
),
tel_email as (
  select distinct on (tel) tel, em
  from o where tel is not null and em is not null
  order by tel, order_date asc
),
tel_joined as (
  select b.tel,
         case when e.em is not null
              and row_number() over (partition by e.em order by b.order_date asc, b.tel) = 1
              then e.em end as em,
         b.customer_name, b.order_no, b.order_date, b.order_source
  from tel_base b
  left join tel_email e using (tel)
),
em_only as (
  select distinct on (em) em, customer_name, order_no, order_date, order_source
  from o
  where tel is null and em is not null
    and em not in (select em from tel_email)
  order by em, order_date asc
)
select {$t}, tel, em, customer_name, order_date, order_no, order_source, 'pending', now(), now() from tel_joined
union all
select {$t}, null, em, customer_name, order_date, order_no, order_source, 'pending', now(), now() from em_only
on conflict do nothing
SQL;

        DB::statement($sql);

        $afterOrders = DB::table('iys_contacts')->where('tenant_id', $t)->count();
        $this->info(sprintf('Tenant %d: siparişlerden %d yeni kişi eklendi (toplam %d).', $t, $afterOrders - $before, $afterOrders));

        if ($this->option('members')) {
            DB::statement($this->membersSql($t));
            $after = DB::table('iys_contacts')->where('tenant_id', $t)->count();
            $this->info(sprintf('Tenant %d: üyelerden %d yeni kişi eklendi (toplam %d).', $t, $after - $afterOrders, $after));
        }

        return self::SUCCESS;
    }

    /**
     * Sipariş vermemiş kayıtlı üyeleri kuyruğa ekler (first_order_at NULL → sona).
     * Sipariş vermiş üyeler zaten kuyruktadır; phone/email unique conflict ile atlanır.
     * E-posta, kuyruktaki veya bu partideki başka bir kişide varsa mükerrer EPOSTA
     * gitmesin diye null bırakılır.
     */
    private function membersSql(int $t): string
    {
        $telRe = self::TEL_RE;
        $emailRe = self::EMAIL_RE;

        return <<<SQL
insert into iys_contacts (tenant_id, phone, email, name, first_order_at, first_order_no, order_source, status, created_at, updated_at)
with m as (
  select
    case when regexp_replace(coalesce(phone,''),'[^0-9]','','g') ~ {$telRe}
         then '90' || right(regexp_replace(phone,'[^0-9]','','g'), 10) end as tel,
    case when email ~ {$emailRe} then lower(email) end as em,
    nullif(trim(coalesce(name,'') || ' ' || coalesce(surname,'')), '') as full_name,
    platform_created_at
  from customers
  where tenant_id = {$t} and platform_type = 'ticimax'
),
tel_base as (
  select distinct on (tel) tel, em, full_name, platform_created_at
  from m where tel is not null
  order by tel, platform_created_at asc nulls last
),
tel_clean as (
  select tel,
         case when em is not null
              and not exists (select 1 from iys_contacts q where q.tenant_id = {$t} and q.email = tel_base.em)
              and row_number() over (partition by em order by platform_created_at asc nulls last, tel) = 1
              then em end as em,
         full_name
  from tel_base
),
em_only as (
  select distinct on (em) em, full_name
  from m
  where tel is null and em is not null
    and not exists (select 1 from iys_contacts q where q.tenant_id = {$t} and q.email = m.em)
    and em not in (select em from tel_clean where em is not null)
  order by em, platform_created_at asc nulls last
)
select {$t}, tel, em, full_name, null::timestamp, null::varchar, 'Uye', 'pending', now(), now() from tel_clean
union all
select {$t}, null::varchar, em, full_name, null::timestamp, null::varchar, 'Uye', 'pending', now(), now() from em_only
on conflict do nothing
SQL;
    }
}
