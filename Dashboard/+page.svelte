<script lang="ts">
  import { onMount } from 'svelte';

  const API_URL = 'https://demoapi-production-9077.up.railway.app';
  const THB = new Intl.NumberFormat('th-TH');

  type BookingStatus = 'PENDING' | 'APPROVE' | 'REJECTED';

  interface Booking {
    id: number;
    user?: { id: number; name: string; points?: number };
    court?: { id: number; name: string };
    date: string;          // "YYYY-MM-DD" หรือ ISO
    startTime: string;     // ISO หรือ "HH:mm"
    endTime: string;       // ISO หรือ "HH:mm"
    status: BookingStatus;
    amount?: number | null;
    slipImage?: string | null;   // 👈 ต้องมีจาก backend เพื่อยิง OCR
  }

  interface UserLite {
    id: number;
    name: string;
    points?: number;
  }

  // ===== state
  let bookings: Booking[] = [];
  let users: UserLite[] = [];
  let loading = true;
  let errorMsg = '';
  let readingMap: Record<number, boolean> = {}; // แสดงสถานะอ่านยอด (กันซ้ำ)

  // ===== helpers
  function toLocalYmd(isoOrYmd: string) {
    if (!isoOrYmd) return '';
    if (isoOrYmd.length > 10) {
      const d = new Date(isoOrYmd);
      if (isNaN(d.getTime())) return isoOrYmd.slice(0, 10);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return isoOrYmd;
  }
  const isSameYmd = (aIso: string, bYmd: string) => toLocalYmd(aIso) === bYmd;

  const todayYmd = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();

  const monthRange = (() => {
    const d = new Date();
    const y = d.getFullYear(), m = d.getMonth();
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    const f = (dt: Date) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return { start: f(start), end: f(end) };
  })();

  function hhmm(v: string) {
    if (!v) return '';
    if (v.length <= 5 && v.includes(':')) return v.slice(0, 5); // "HH:mm"
    const d = new Date(v);
    if (isNaN(d.getTime())) return v.slice(11, 16) || v.slice(0, 5) || '';
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const formatTimeRange = (s: string, e: string) => `${hhmm(s)} - ${hhmm(e)}`;
  const baht = (n: number | null | undefined) => `${THB.format(n ?? 0)} ฿`;
  const token = () => localStorage.getItem('token') ?? '';

  // ===== fetchers
  async function fetchAll() {
    loading = true;
    errorMsg = '';
    try {
      const t = token();
      if (!t) throw new Error('token not found');

      const bRes = await fetch(`${API_URL}/api/bookings`, {
        headers: { Authorization: `Bearer ${t}` }
      });
      if (!bRes.ok) throw new Error(`bookings HTTP ${bRes.status}`);
      bookings = await bRes.json();

      // (ถ้าต้องใช้ users ให้เปิดส่วนนี้เมื่อ backend พร้อม)
      users = [];
    } catch (e: any) {
      errorMsg = e?.message ?? 'โหลดข้อมูลล้มเหลว';
      bookings = [];
      users = [];
    } finally {
      loading = false;
    }
  }

  // ===== OCR (endpoint ใหม่)
  async function readAmountFor(b: Booking) {
    if (!b?.id || !b?.slipImage) return;
    if (readingMap[b.id]) return;
    readingMap[b.id] = true;

    try {
      const res = await fetch(`${API_URL}/api/payment/ocr-read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`
        },
        body: JSON.stringify({ imagePath: b.slipImage, bookingId: b.id })
      });

      if (!res.ok) {
        // ไม่เด้ง alert หน้านี้ เพื่อไม่รก UI (ดู error ใน console แทน)
        console.warn('ocr-read failed', b.id, res.status, await res.text().catch(() => ''));
        return;
      }

      const data = await res.json();
      const amt = Number(data?.amount);
      const idx = bookings.findIndex(x => x.id === b.id);
      if (idx >= 0 && Number.isFinite(amt)) {
        bookings[idx] = { ...bookings[idx], amount: amt };
      }
    } catch (err) {
      console.error('ocr-read error', err);
    } finally {
      readingMap[b.id] = false;
    }
  }

  // อ่านยอดอัตโนมัติสำหรับแถวที่ยังไม่มี amount
  async function ensureAmountsAuto() {
    // เลือกเฉพาะรายการที่ยังไม่มี amount และมี slipImage (เว้น REJECTED)
    const targets = bookings.filter(
      (b) => (b.amount == null || isNaN(Number(b.amount))) &&
             b.slipImage && b.status !== 'REJECTED'
    );

    // วิ่งทีละนิดกันสแปม (เช่น ลิมิต 3 คิว)
    const CONCURRENCY = 3;
    let i = 0;
    async function worker() {
      while (i < targets.length) {
        const b = targets[i++];
        await readAmountFor(b);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));
  }

  // ===== computed
  $: todayBookings = bookings.filter(b => isSameYmd(b.date, todayYmd));
  $: monthBookings = bookings.filter(b => {
    const ymd = toLocalYmd(b.date);
    return ymd >= monthRange.start && ymd <= monthRange.end;
  });

  $: todayCount = todayBookings.length;
  $: monthCount = monthBookings.length;

  $: revenueToday = todayBookings
    .filter(b => b.status === 'APPROVE')
    .reduce((sum, b) => sum + (Number(b.amount ?? 0) || 0), 0);

  $: revenueMonth = monthBookings
    .filter(b => b.status === 'APPROVE')
    .reduce((sum, b) => sum + (Number(b.amount ?? 0) || 0), 0);

  $: pendingBookings = bookings
    .filter(b => b.status === 'PENDING')
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 8);

  $: recentBookings = bookings
    .slice()
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 8);

  $: topUsersByPoints = (users?.length ? users : (Array.from(
        new Map(
          bookings
            .filter(b => b.user?.id)
            .map(b => [b.user!.id, { id: b.user!.id, name: b.user!.name, points: b.user?.points ?? 0 }])
        ).values()
      ) as UserLite[]))
    .filter(u => typeof u.points === 'number')
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, 5);

  onMount(async () => {
    await fetchAll();
    // หลังโหลดรายการแล้ว พยายามดึงยอดเงินอัตโนมัติ
    await ensureAmountsAuto();
  });
</script>

<style>
  .grid { display: grid; gap: 1rem; }
  .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .card {
    background: #fff; border: 1px solid #e6e6e6; border-radius: 10px; padding: 1rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }
  .kpi { display:flex; flex-direction:column; gap:.25rem }
  .kpi .label { color:#777; font-size:.9rem }
  .kpi .value { font-size:1.6rem; font-weight:700 }
  .kpi .hint { color:#999; font-size:.8rem }

  .two-col { grid-template-columns: 1fr 1fr; }
  table { width:100%; border-collapse: collapse; }
  th, td { border-top:1px solid #eee; padding:.6rem .5rem; text-align:left; font-size:.95rem }
  th { color:#666; font-weight:600; background:#fafafa }
  .status { padding:.2rem .5rem; border-radius:999px; font-size:.75rem; font-weight:700; display:inline-block }
  .APPROVE { background:#e9f9ef; color:#179f51; }
  .PENDING { background:#fff4e5; color:#b46900; }
  .REJECTED { background:#ffe9e9; color:#c0392b; }

  .actions { display:flex; gap:.5rem; flex-wrap:wrap }
  .btn {
    background:#2563eb; color:#fff; border:none; padding:.55rem .8rem; border-radius:8px; cursor:pointer;
    text-decoration:none; display:inline-flex; align-items:center; gap:.4rem; font-weight:600;
  }
  .btn.alt { background:#10b981; }
  .btn.warn { background:#f59e0b; }
  .muted { color:#888; font-size:.9rem }
</style>

<h2>📊 Dashboard (Admin)</h2>

{#if loading}
  <div class="card">กำลังโหลดข้อมูล…</div>
{:else}
  {#if errorMsg}
    <div class="card" style="border-color:#ffd0d0; background:#fff7f7; color:#b91c1c">
      ❌ {errorMsg}
    </div>
  {/if}

  <!-- KPI cards -->
  <div class="grid kpis">
    <div class="card kpi">
      <div class="label">จำนวนการจองวันนี้</div>
      <div class="value">{todayCount.toLocaleString()}</div>
      <div class="hint">วันที่ {todayYmd}</div>
    </div>
    <div class="card kpi">
      <div class="label">จำนวนการจองเดือนนี้</div>
      <div class="value">{monthCount.toLocaleString()}</div>
      <div class="hint">{monthRange.start} – {monthRange.end}</div>
    </div>
    <div class="card kpi">
      <div class="label">รายได้วันนี้ (อนุมัติแล้ว)</div>
      <div class="value">{baht(revenueToday)}</div>
      <div class="hint">รวมจากยอดในสลิปที่อ่านได้</div>
    </div>
    <div class="card kpi">
      <div class="label">รายได้เดือนนี้ (อนุมัติแล้ว)</div>
      <div class="value">{baht(revenueMonth)}</div>
      <div class="hint">รวมจากยอดในสลิปที่อ่านได้</div>
    </div>
  </div>

  <!-- Quick actions -->
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap">
      <strong>Quick actions</strong>
      <div class="actions">
        <a class="btn" href="/App/booking">จัดการคำขอจอง</a>
        <a class="btn alt" href="/App/courts">เช็คสถานะสนาม</a>
        <a class="btn warn" href="/App/reports">ออกรายงาน / พิมพ์ PDF</a>
        <a class="btn" href="/App/courtmanage">จัดการ TimeSlots</a>
      </div>
    </div>
  </div>

  <!-- two columns -->
  <div class="grid two-col">
    <!-- Pending -->
    <div class="card">
      <strong>การจองที่รออนุมัติ</strong>
      {#if pendingBookings.length === 0}
        <div class="muted" style="margin-top:.5rem">— ไม่มีรายการรออนุมัติ —</div>
      {:else}
        <table style="margin-top:.5rem">
          <thead>
            <tr>
              <th>ผู้จอง</th>
              <th>สนาม</th>
              <th>วัน/เวลา</th>
              <th>สถานะ</th>
              <th>ยอดเงิน</th>
            </tr>
          </thead>
          <tbody>
            {#each pendingBookings as b}
              <tr>
                <td>{b.user?.name ?? '-'}</td>
                <td>{b.court?.name ?? '-'}</td>
                <td>{toLocalYmd(b.date)} • {formatTimeRange(b.startTime, b.endTime)}</td>
                <td><span class="status {b.status}">{b.status}</span></td>
                <td>{baht(b.amount ?? 0)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <!-- Recent bookings -->
    <div class="card">
      <strong>การจองล่าสุด</strong>
      {#if recentBookings.length === 0}
        <div class="muted" style="margin-top:.5rem">— ยังไม่มีรายการ —</div>
      {:else}
        <table style="margin-top:.5rem)">
          <thead>
            <tr>
              <th>ผู้จอง</th>
              <th>สนาม</th>
              <th>วัน/เวลา</th>
              <th>สถานะ</th>
              <th>ยอดเงิน</th>
            </tr>
          </thead>
          <tbody>
            {#each recentBookings as b}
              <tr>
                <td>{b.user?.name ?? '-'}</td>
                <td>{b.court?.name ?? '-'}</td>
                <td>{toLocalYmd(b.date)} • {formatTimeRange(b.startTime, b.endTime)}</td>
                <td><span class="status {b.status}">{b.status}</span></td>
                <td>{baht(b.amount ?? 0)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
{/if}


  <!-- Top users by points (if available)
  <div class="card">
    <strong>ผู้ใช้แต้มสูงสุด</strong>
    {#if topUsersByPoints.length === 0}
      <div class="muted" style="margin-top:.5rem">— ไม่มีข้อมูลแต้มผู้ใช้ —</div>
    {:else}
      <table style="margin-top:.5rem">
        <thead>
          <tr>
            <th>ผู้ใช้</th>
            <th>แต้มสะสม</th>
          </tr>
        </thead>
        <tbody>
          {#each topUsersByPoints as u}
            <tr>
              <td>{u.name}</td>
              <td>{(u.points ?? 0).toLocaleString()}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <div class="muted" style="margin-top:.5rem">
      * ถ้า backend ยังไม่มี endpoint /api/users หรือไม่ส่ง field points มา ตารางนี้จะแสดงเฉพาะข้อมูลที่หาได้
    </div>
  </div> -->
