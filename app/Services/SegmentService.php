<?php

namespace App\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Pazarlama segmentasyonu — kural (jsonb definition) → marketing_profiles sorgusu.
 *
 * Kural sözleşmesi (tümü opsiyonel, AND ile bağlanır):
 *  membership: 'any'|'member'|'guest'      — üyelikli / üyeliksiz alışveriş
 *  has_phone / has_email: bool             — iletişim kanalı şartı
 *  min_orders / max_orders: int            — sipariş adedi
 *  min_total / max_total: number           — toplam harcama (tam iadeler hariç)
 *  min_max_order: number                   — en az bir siparişi X TL üzeri
 *  last_order_older_days: int              — son siparişi X günden ESKİ (almış-bırakmış)
 *  last_order_within_days: int             — son X gün içinde sipariş (aktif)
 *  first_order_within_days: int            — ilk siparişi son X günde (yeni müşteri)
 *  sources: string[]                       — ilk sipariş kanalı (TicimaxWeb/NativeAndroid/NativeIOS)
 */
class SegmentService
{
    public const EXPORT_FIELDS = [
        'name' => 'Ad Soyad',
        'phone' => 'Telefon',
        'email' => 'E-posta',
        'is_member' => 'Üyelik',
        'orders_count' => 'Sipariş Adedi',
        'total_spent' => 'Toplam Harcama',
        'max_order_amount' => 'En Yüksek Sipariş',
        'first_order_at' => 'İlk Sipariş',
        'last_order_at' => 'Son Sipariş',
        'first_source' => 'Kanal',
    ];

    public static function query(int $tenantId, array $def): Builder
    {
        $q = DB::table('marketing_profiles')->where('tenant_id', $tenantId);

        match ($def['membership'] ?? 'any') {
            'member' => $q->where('is_member', true),
            'guest' => $q->where('is_member', false),
            default => null,
        };

        if (! empty($def['has_phone'])) {
            $q->whereNotNull('phone');
        }
        if (! empty($def['has_email'])) {
            $q->whereNotNull('email');
        }
        if (isset($def['min_orders'])) {
            $q->where('orders_count', '>=', (int) $def['min_orders']);
        }
        if (isset($def['max_orders'])) {
            $q->where('orders_count', '<=', (int) $def['max_orders']);
        }
        if (isset($def['min_total'])) {
            $q->where('total_spent', '>=', (float) $def['min_total']);
        }
        if (isset($def['max_total'])) {
            $q->where('total_spent', '<=', (float) $def['max_total']);
        }
        if (isset($def['min_max_order'])) {
            $q->where('max_order_amount', '>=', (float) $def['min_max_order']);
        }
        if (isset($def['last_order_older_days'])) {
            $q->where('last_order_at', '<', now()->subDays((int) $def['last_order_older_days']));
        }
        if (isset($def['last_order_within_days'])) {
            $q->where('last_order_at', '>=', now()->subDays((int) $def['last_order_within_days']));
        }
        if (isset($def['first_order_within_days'])) {
            $q->where('first_order_at', '>=', now()->subDays((int) $def['first_order_within_days']));
        }
        if (! empty($def['sources']) && is_array($def['sources'])) {
            $q->whereIn('first_source', $def['sources']);
        }

        return $q;
    }

    /** Kural şemasında olmayan anahtarları ayıklar (panelden gelen tanım için). */
    public static function sanitizeDefinition(array $def): array
    {
        $allowed = [
            'membership', 'has_phone', 'has_email', 'min_orders', 'max_orders',
            'min_total', 'max_total', 'min_max_order', 'last_order_older_days',
            'last_order_within_days', 'first_order_within_days', 'sources',
        ];

        return array_filter(
            array_intersect_key($def, array_flip($allowed)),
            fn ($v) => $v !== null && $v !== '' && $v !== [] && $v !== false,
        );
    }

    /**
     * marketing_profiles tablosunu siparişlerden yeniden kurar (tenant bazlı, tek transaction).
     * Tekilleştirme İYS seed'i ile aynı: normalize telefon esas, telefonsuzlar e-posta ile.
     */
    public static function refreshProfiles(int $tenantId): int
    {
        $telRe = "'^(90|0)?5[0-9]{9}$'";
        $emailRe = "'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$'";
        $sources = "('TicimaxWeb','NativeAndroid','NativeIOS')";
        // status 13 = İade Ödemesi Yapıldı → harcama toplamına girmez
        $refunded = 13;
        // 100k TL üzeri tekil siparişler veri anomalisi (1 ürünlük yuvarlak milyonluk
        // manuel/test kayıtları, 109 adet) → parasal metriklere katılmaz
        $anomalyCap = 100000;

        DB::transaction(function () use ($tenantId, $telRe, $emailRe, $sources, $refunded, $anomalyCap) {
            DB::table('marketing_profiles')->where('tenant_id', $tenantId)->delete();
            DB::statement(<<<SQL
insert into marketing_profiles (tenant_id, phone, email, name, is_member, orders_count, refunded_count,
                                total_spent, max_order_amount, first_order_at, last_order_at, first_source,
                                created_at, updated_at)
with o as (
  select
    case when regexp_replace(coalesce(o.billing_address->>'phone',''),'[^0-9]','','g') ~ {$telRe}
         then '90' || right(regexp_replace(o.billing_address->>'phone','[^0-9]','','g'), 10) end as tel,
    case when o.customer_email ~ {$emailRe} then lower(o.customer_email) end as em,
    o.customer_name, o.order_date, o.order_source, o.total_amount, o.status,
    (c.member_type = 'Standart Uye') as uye
  from orders o
  left join customers c on c.id = o.customer_id
  where o.tenant_id = {$tenantId} and o.order_source in {$sources}
),
keyed as (
  select coalesce(tel, 'em:' || em) as pkey, * from o where tel is not null or em is not null
),
agg as (
  select pkey,
         max(tel) as tel,
         min(em) as em,
         (array_agg(customer_name order by order_date desc))[1] as name,
         bool_or(coalesce(uye, false)) as is_member,
         count(*) as orders_count,
         count(*) filter (where status = {$refunded}) as refunded_count,
         coalesce(sum(total_amount) filter (where status <> {$refunded} and total_amount <= {$anomalyCap}), 0) as total_spent,
         coalesce(max(total_amount) filter (where total_amount <= {$anomalyCap}), 0) as max_order_amount,
         min(order_date) as first_order_at,
         max(order_date) as last_order_at,
         (array_agg(order_source order by order_date asc))[1] as first_source
  from keyed group by pkey
),
dedup_em as (
  -- aynı e-posta birden çok telefonda: yalnız en eski profilde kalsın (unique index şartı)
  select agg.*,
         case when em is not null
              and row_number() over (partition by em order by first_order_at asc, pkey) = 1
              then em end as em_final
  from agg
)
select {$tenantId}, tel, em_final, name, is_member, orders_count, refunded_count,
       total_spent, max_order_amount, first_order_at, last_order_at, first_source, now(), now()
from dedup_em
where tel is not null or em_final is not null
on conflict do nothing
SQL);

            // Faz 2: hiç sipariş vermemiş site üyeleri (İYS tabanıyla aynı evren) —
            // orders_count=0, first_source='Uye'. Telefonu/e-postası siparişli bir
            // profile aitse eklenmez; yalnız e-posta çakışıyorsa e-postasız düşer.
            DB::statement(<<<SQL
insert into marketing_profiles (tenant_id, phone, email, name, is_member, orders_count, refunded_count,
                                total_spent, max_order_amount, first_order_at, last_order_at, first_source,
                                created_at, updated_at)
with c as (
  select
    case when regexp_replace(coalesce(phone,''),'[^0-9]','','g') ~ {$telRe}
         then '90' || right(regexp_replace(phone,'[^0-9]','','g'), 10) end as tel,
    case when email ~ {$emailRe} then lower(email) end as em,
    nullif(trim(concat(coalesce(name,''), ' ', coalesce(surname,''))), '') as nm,
    id
  from customers
  where tenant_id = {$tenantId} and platform_type = 'ticimax'
),
keyed as (
  select coalesce(tel, 'em:' || em) as pkey, * from c where tel is not null or em is not null
),
agg as (
  select pkey, max(tel) as tel, min(em) as em, (array_agg(nm order by id))[1] as nm
  from keyed group by pkey
),
fresh as (
  -- telefonu zaten (siparişten) profillenmiş üyeler atlanır
  select a.* from agg a
  where a.tel is null
     or not exists (select 1 from marketing_profiles p where p.tenant_id = {$tenantId} and p.phone = a.tel)
),
emx as (
  select f.*,
         case when em is not null
              and not exists (select 1 from marketing_profiles p where p.tenant_id = {$tenantId} and p.email = f.em)
              and row_number() over (partition by em order by pkey) = 1
              then em end as em_final
  from fresh f
)
select {$tenantId}, tel, em_final, nm, true, 0, 0, 0, 0, null::timestamp, null::timestamp, 'Uye', now(), now()
from emx
where tel is not null or em_final is not null
on conflict do nothing
SQL);
        });

        return DB::table('marketing_profiles')->where('tenant_id', $tenantId)->count();
    }

    /** Sistem havuzları (daima güncellenir) + örnek senaryolar (yalnız yoksa) oluşturur. */
    public static function seedDefaults(int $tenantId): void
    {
        $defaults = [
            // [ad, açıklama, kural, sistem?, sıra]
            ['Tüm Kişiler', 'Sipariş vermiş herkes + hiç sipariş vermemiş site üyeleri — tüm pazarlama evreni.', [], true, 0],
            ['Tüm Müşteriler', 'Site + mobil uygulamadan sipariş vermiş herkes (pazaryeri hariç).', ['min_orders' => 1], true, 1],
            ['Üyelikli Alışveriş', 'En az bir siparişini üye girişiyle vermiş müşteriler.', ['membership' => 'member', 'min_orders' => 1], true, 2],
            ['Üyeliksiz Alışveriş', 'Tüm siparişlerini üye olmadan (misafir) vermiş müşteriler.', ['membership' => 'guest', 'min_orders' => 1], true, 3],
            ['Almış Bırakmış (6 ay+)', 'Sipariş vermiş ama son 180 gündür sessiz olan müşteriler.', ['min_orders' => 1, 'last_order_older_days' => 180], false, 10],
            ['Yüksek Harcama (10.000 TL+)', 'Toplam harcaması 10.000 TL üzeri müşteriler.', ['min_total' => 10000], false, 11],
            ['Sadık Müşteri (5+ sipariş)', 'En az 5 sipariş vermiş müşteriler.', ['min_orders' => 5], false, 12],
            ['Tek Siparişlik', 'Yalnızca 1 sipariş vermiş müşteriler — ikinci siparişe ikna hedefi.', ['min_orders' => 1, 'max_orders' => 1], false, 13],
            ['Yeni Müşteri (Son 30 gün)', 'İlk siparişini son 30 günde vermiş müşteriler.', ['first_order_within_days' => 30], false, 14],
            ['Sipariş Vermemiş Üyeler', 'Üye olmuş ama hiç sipariş vermemiş kişiler — ilk siparişe ikna hedefi.', ['membership' => 'member', 'max_orders' => 0], false, 15],
        ];

        foreach ($defaults as [$name, $desc, $def, $system, $sort]) {
            if ($system) {
                // Sistem havuzları düzenlenemez → tanım her seed'de güncel tutulur
                DB::table('marketing_segments')->updateOrInsert(
                    ['tenant_id' => $tenantId, 'name' => $name],
                    ['description' => $desc, 'definition' => json_encode($def), 'is_system' => true,
                        'sort' => $sort, 'created_at' => now(), 'updated_at' => now()],
                );
            } else {
                // Senaryolar kullanıcı tarafından düzenlenebilir → yalnız yoksa eklenir
                // (updateOrInsert kullanıcının düzenlemesini her gece ezerdi)
                $exists = DB::table('marketing_segments')
                    ->where('tenant_id', $tenantId)->where('name', $name)->exists();
                if (! $exists) {
                    DB::table('marketing_segments')->insert([
                        'tenant_id' => $tenantId, 'name' => $name, 'description' => $desc,
                        'definition' => json_encode($def), 'is_system' => false, 'sort' => $sort,
                        'created_at' => now(), 'updated_at' => now(),
                    ]);
                }
            }
        }
    }

    /**
     * Segmentin canlı sayımları (10 dk cache, seg-ver-{t} ile invalidate) —
     * segment sayfası ve kampanya hedef seçicisi aynı kaynağı kullanır.
     *
     * @return array{total:int, with_phone:int, with_email:int}
     */
    public static function cachedCounts(int $tenantId, object $segment): array
    {
        $ver = (int) \Illuminate\Support\Facades\Cache::get("seg-ver-{$tenantId}", 0);
        $key = "seg-count-{$tenantId}-v{$ver}-{$segment->id}-".md5(json_encode($segment->definition));

        return \Illuminate\Support\Facades\Cache::remember($key, 600, function () use ($tenantId, $segment) {
            $q = self::query($tenantId, (array) ($segment->definition ?? []));

            return [
                'total' => (clone $q)->count(),
                'with_phone' => (clone $q)->whereNotNull('phone')->count(),
                'with_email' => (clone $q)->whereNotNull('email')->count(),
            ];
        });
    }
}
