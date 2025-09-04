<!-- src/routes/App/dashboard/+page.svelte -->
<script lang="ts" context="module">
  export const ssr = false;
  export const prerender = false;
</script>

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import NotificationBell from "$lib/ui/NotificationBell.svelte";
  import BookingToast from "$lib/ui/BookingToast.svelte";

  import { connectSocket } from "$lib/realtime/socket";
  // ⬇️ ใช้ตัวที่ join room จริง
  import { bindDashboardNoti, resetNotifications } from "$lib/realtime/admin-noti";

  // ===== socket =====
  function readJWT(): string {
    const s =
      localStorage.getItem("jwt") ??
      localStorage.getItem("token") ??
      sessionStorage.getItem("jwt") ??
      sessionStorage.getItem("token");
    if (s) return s;
    const m = document.cookie.match(/(?:^|;\s*)jwt=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  const apiToken = () => readJWT();

  let unbindNoti: (() => void) | undefined;

  onMount(() => {
    const jwt = readJWT();
    if (!jwt) {
      console.warn("No JWT found. Skipping socket connection.");
      return;
    }
    const s = connectSocket(jwt);
    (window as any).s = s;                      // debug convenience
    s.onAny((ev, ...args) => console.log("[socket] <-", ev, ...args)); // ดูทุกอีเวนต์เข้า

    // ✅ join ห้อง 'admins' + ส่ง token ให้ BE
    unbindNoti = bindDashboardNoti(s, {
      room: "admins",
      token: jwt,
      playSound: true,
      // ถ้า BE ใช้ชื่ออีเวนต์ join อื่น ให้เปิดคอมเมนต์และแก้ชื่อ
      // joinEventName: "admin-join",
      // leaveEventName: "admin-leave",
    });
  });

  onDestroy(() => {
    unbindNoti?.();
    resetNotifications();
  });

  // ===== REST (widgets) =====
  const API_URL = "https://demoapi-production-9077.up.railway.app";
  type PeriodType = "daily" | "monthly";
  interface RevenueNode { bookings?: number; walkIns?: number; total?: number }
  interface DetailNode {
    courtId?: number; courtName?: string;
    daily?:   { bookings?: number; walkIns?: number; total?: number; revenue?: RevenueNode } | null;
    monthly?: { bookings?: number; walkIns?: number; total?: number; revenue?: RevenueNode } | null;
  }
  interface SummaryRes {
    period?: { type?: PeriodType; start?: string; end?: string; date?: string | null; month?: string | null };
    summary?: { totalBookings?: number; totalWalkIns?: number; totalAll?: number; revenue?: RevenueNode } & Record<string, unknown>;
    details?: DetailNode[];
  }
  type CourtMonthlyAPI = { courtId?: number; courtName?: string; bookings?: number; walkIns?: number; total?: number; revenue?: { total?: number } };

  const z2 = (n:number)=> String(n).padStart(2,"0");
  const todayYMD = (()=>{ const d=new Date(); return `${d.getFullYear()}-${z2(d.getMonth()+1)}-${z2(d.getDate())}`; })();
  const thisMonthYM = (()=>{ const d=new Date(); return `${d.getFullYear()}-${z2(d.getMonth()+1)}`; })();
  const fmtBaht = (n:number)=> `${n.toLocaleString("th-TH")} ฿`;

  function pickAmountFromSummary(s: SummaryRes["summary"]): number {
    return Number(s?.revenue?.total ?? 0);
  }
  function sumAmountFromDetails(res: SummaryRes, type: PeriodType){
    const key: keyof DetailNode = type === "daily" ? "daily" : "monthly";
    return (res.details ?? []).reduce((sum, d: DetailNode) => {
      const node = d[key] ?? undefined;
      const rev = Number(node?.revenue?.total ?? 0);
      return sum + (Number.isFinite(rev) ? rev : 0);
    },0);
  }
  const pickCount = (s: SummaryRes["summary"]) =>
    (Number(s?.totalAll) || (Number(s?.totalBookings)||0) + (Number(s?.totalWalkIns)||0));

  async function fetchSummary(params: {date?: string; month?: string}) {
    const qs = new URLSearchParams();
    if (params.date)  qs.set("date", params.date);
    if (params.month) qs.set("month", params.month);
    const res = await fetch(`${API_URL}/api/bookings/summary?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${apiToken()}` }
    });
    if (!res.ok) throw new Error(`summary HTTP ${res.status}`);
    const data = await res.json();
    return (Array.isArray(data) ? data[0] : data) as SummaryRes;
  }

  let selDate  = todayYMD;
  let selMonth = thisMonthYM;

  let loading = true;
  let err = "";
  let todayCount = 0;
  let monthCount = 0;
  let revenueDay  = 0;
  let revenueMon  = 0;

  type CourtRow = { courtId?: number; courtName?: string; bookings: number; walkIns: number; total: number; amount: number };
  let courtMonthly: CourtRow[] = [];

  async function loadAll() {
    loading = true; err = "";
    try {
      const [daily, monthly] = await Promise.all([
        fetchSummary({ date: selDate }),
        fetchSummary({ month: selMonth })
      ]);

      todayCount = pickCount(daily.summary || {});
      monthCount = pickCount(monthly.summary || {});
      revenueDay = pickAmountFromSummary(daily.summary) || sumAmountFromDetails(daily, "daily") || 0;
      revenueMon = pickAmountFromSummary(monthly.summary) || sumAmountFromDetails(monthly, "monthly") || 0;

      const details = (monthly.details ?? []) as Array<DetailNode & CourtMonthlyAPI>;
      courtMonthly = details.map((d) => ({
        courtId: d.courtId,
        courtName: d.courtName ?? "-",
        bookings: Number(d.bookings ?? 0),
        walkIns : Number(d.walkIns ?? 0),
        total   : Number(d.total ?? 0),
        amount  : Number(d.revenue?.total ?? 0)
      })).sort((a,b)=> b.amount - a.amount);

    } catch (e: unknown) {
      err = e instanceof Error ? e.message : "โหลดข้อมูลสรุปล้มเหลว";
      todayCount = monthCount = 0;
      revenueDay = revenueMon = 0;
      courtMonthly = [];
    } finally {
      loading = false;
    }
  }

  function resetToday()  { selDate = todayYMD; loadAll(); }
  function resetMonth()  { selMonth = thisMonthYM; loadAll(); }

  onMount(loadAll);
</script>

<style>
  .grid { display:grid; gap:1rem; }
  .kpis { grid-template-columns: repeat(4, minmax(0,1fr)); }
  .card { background:#fff; border:1px solid #eaeaea; border-radius:12px; padding:1rem; box-shadow:0 2px 8px rgba(0,0,0,.04); }
  .kpi { display:flex; flex-direction:column; gap:.25rem }
  .label { color:#777; font-size:.9rem }
  .value { font-size:1.7rem; font-weight:700 }
  .hint  { color:#999; font-size:.8rem }
  table { width:100%; border-collapse:collapse; }
  th, td { padding:.55rem .6rem; border-top:1px solid #eee; text-align:left }
  th { background:#fafafa; color:#555 }
  .right { text-align:right }
  .actions { display:flex; gap:.5rem; flex-wrap:wrap }
  .btn { background:#2563eb; color:#fff; border:none; padding:.55rem .8rem; border-radius:8px; cursor:pointer; font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:.4rem; }
  .btn.alt  { background:#10b981; }
  .btn.warn { background:#f59e0b; }
  .filters { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap }
  .input { padding:.4rem .5rem; border:1px solid #ddd; border-radius:6px; }
</style>

<section class="flex items-center justify-between mb-3">
  <h2 style="font-weight:700;font-size:1.4rem">📊 Dashboard (Admin)</h2>
  <NotificationBell />
</section>

<div class="card filters" style="margin-bottom:1rem">
  <div>
    <label for="dash-date">วันที่: </label>
    <input id="dash-date" class="input" type="date" bind:value={selDate} on:change={loadAll} />
    <button class="btn" on:click={resetToday}>วันนี้</button>
  </div>
  <div>
    <label for="dash-month">เดือน: </label>
    <input id="dash-month" class="input" type="month" bind:value={selMonth} on:change={loadAll} />
    <button class="btn" on:click={resetMonth}>เดือนนี้</button>
  </div>
  <button class="btn alt" on:click={loadAll}>รีเฟรช</button>
</div>

{#if loading}
  <div class="card">กำลังโหลดข้อมูลสรุป…</div>
{:else if err}
  <div class="card" style="border-color:#ffd0d0;background:#fff7f7;color:#b91c1c">❌ {err}</div>
{:else}
  <div class="grid kpis">
    <div class="card kpi">
      <div class="label">จำนวนทั้งหมด (จอง+Walk-in) — {selDate}</div>
      <div class="value">{todayCount.toLocaleString("th-TH")}</div>
      <div class="hint">ช่วงวัน: {selDate}</div>
    </div>
    <div class="card kpi">
      <div class="label">จำนวนทั้งหมด (จอง+Walk-in) — {selMonth}</div>
      <div class="value">{monthCount.toLocaleString("th-TH")}</div>
      <div class="hint">ช่วงเดือน: {selMonth}</div>
    </div>
    <div class="card kpi">
      <div class="label">รายได้ของวัน</div>
      <div class="value">{fmtBaht(revenueDay)}</div>
      <div class="hint">รวม booking + walk-in</div>
    </div>
    <div class="card kpi">
      <div class="label">รายได้ของเดือน</div>
      <div class="value">{fmtBaht(revenueMon)}</div>
      <div class="hint">รวม booking + walk-in</div>
    </div>
  </div>

  <div class="card" style="margin-top:1rem">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
      <strong>Quick actions</strong>
      <div class="actions">
        <a class="btn" href="/App/booking">จัดการคำขอจอง</a>
        <a class="btn alt" href="/App/courts">เช็คสถานะสนาม</a>
        <a class="btn warn" href="/App/reports">ออกรายงาน / พิมพ์ PDF</a>
        <a class="btn" href="/App/courtmanage">จัดการ TimeSlots</a>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:1rem">
    <strong>สรุปตามสนาม (เดือน {selMonth})</strong>
    {#if courtMonthly.length === 0}
      <div style="margin-top:.5rem;color:#777">— ยังไม่มีข้อมูล —</div>
    {:else}
      <table style="margin-top:.5rem">
        <thead>
          <tr>
            <th>สนาม</th>
            <th class="right">จอง</th>
            <th class="right">Walk-in</th>
            <th class="right">รวมครั้ง</th>
            <th class="right">ยอดเงิน</th>
          </tr>
        </thead>
        <tbody>
          {#each courtMonthly as r}
            <tr>
              <td>{r.courtName}</td>
              <td class="right">{r.bookings.toLocaleString("th-TH")}</td>
              <td class="right">{r.walkIns.toLocaleString("th-TH")}</td>
              <td class="right">{r.total.toLocaleString("th-TH")}</td>
              <td class="right">{fmtBaht(r.amount)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{/if}

<!-- Toast เฉพาะหน้านี้ -->
<BookingToast />
