<script lang="ts">
  import { onMount } from 'svelte';
  import jsPDF from 'jspdf';
  // @ts-ignore
  import autoTable from 'jspdf-autotable';

  const API_URL = 'https://demoapi-production-9077.up.railway.app';
  const token = () => localStorage.getItem('token') ?? '';

  // ฟอนต์ไทย
  // @ts-ignore
  import sarabunRegularUrl from '$lib/fonts/Sarabun-Regular.ttf?url';
  // @ts-ignore
  import sarabunBoldUrl from '$lib/fonts/Sarabun-Bold.ttf?url';

  type PeriodType = 'monthly' | 'daily';

  // โครงสร้างตาม 6.1
  interface SummaryRes {
    period?: { type?: PeriodType; date?: string|null; month?: string|null };
    summary?: {
      totalBookings?: number;
      totalWalkIns?: number;
      totalAll?: number;
      revenue?: { bookings?: number; walkIns?: number; total?: number };
      // กันเหนียวชื่ออื่น ๆ ที่เคยเจอ
      totalAmountAll?: number; amountAll?: number; revenueAll?: number;
      totalAmountBookings?: number; totalAmountWalkIns?: number;
    };
    details?: Array<{
      courtId?: number;
      courtName?: string;
      bookings?: number;
      walkIns?: number;
      total?: number;
      revenue?: { bookings?: number; walkIns?: number; total?: number };
    }>;
  }

  const pad2 = (n:number)=> String(n).padStart(2,'0');
  const baht = (n:number)=> `${(n||0).toLocaleString('th-TH')} ฿`;
  const now = new Date();
  let monthYM = `${now.getFullYear()}-${pad2(now.getMonth()+1)}`; // YYYY-MM

  let loading = false;
  let err = '';

  // state สรุปรายเดือน
  let monthCount = 0;
  let monthAmount = 0;

  type Row = { courtName: string; bookings: number; walkIns: number; total: number; amount: number };
  let rows: Row[] = [];

  function pickAmount(s: SummaryRes['summary']): number {
    if (!s) return 0;
    const fromRevenue = Number(s.revenue?.total);
    if (Number.isFinite(fromRevenue)) return fromRevenue;
    const direct = Number(s.totalAmountAll ?? s.amountAll ?? s.revenueAll);
    if (Number.isFinite(direct)) return direct;
    const sumBoth = Number(s.totalAmountBookings ?? 0) + Number(s.totalAmountWalkIns ?? 0);
    return sumBoth || 0;
  }

  function pickCount(s: SummaryRes['summary']): number {
    if (!s) return 0;
    const all = Number(s.totalAll);
    if (Number.isFinite(all)) return all;
    return Number(s.totalBookings ?? 0) + Number(s.totalWalkIns ?? 0);
  }

  async function fetchMonthly() {
    loading = true; err = '';
    try {
      const qs = new URLSearchParams({ month: monthYM });
      const res = await fetch(`${API_URL}/api/bookings/summary?${qs}`, {
        headers: { Authorization: `Bearer ${token()}` },
        cache: 'no-store'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: SummaryRes = await res.json().then(d => Array.isArray(d) ? d[0] : d);

      monthCount  = pickCount(data.summary);
      monthAmount = pickAmount(data.summary);

      rows = (data.details ?? []).map(d => ({
        courtName: d.courtName ?? '-',
        bookings: Number(d.bookings ?? 0),
        walkIns : Number(d.walkIns  ?? 0),
        total   : Number(d.total    ?? 0),
        amount  : Number(d.revenue?.total ?? 0)
      })).sort((a,b)=> b.amount - a.amount);
    } catch (e:any) {
      err = e?.message ?? 'โหลดข้อมูลรายเดือนไม่สำเร็จ';
      monthCount = monthAmount = 0; rows = [];
    } finally {
      loading = false;
    }
  }

 // ---------- สรุปยอดเงินตามสนาม (คำนวณจาก rows) ----------
type MoneyByCourt = { courtName: string; amount: number; percent: number };

// ประกาศตัวแปรก่อน (ป้องกัน error)
let moneyByCourt: MoneyByCourt[] = [];
let totalAmount = 0;

// คำนวณใหม่ทุกครั้งที่ rows เปลี่ยน
$: totalAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);

$: moneyByCourt = rows.map((r) => ({
  courtName: r.courtName,
  amount: r.amount || 0,
  percent: totalAmount > 0 ? ((r.amount || 0) / totalAmount) * 100 : 0
}));


  // ---------- PDF helpers ----------
  async function fetchAsBase64(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  async function ensureThaiFont(doc: jsPDF) {
    try {
      const reg = await fetchAsBase64(sarabunRegularUrl);
      doc.addFileToVFS('Sarabun-Regular.ttf', reg);
      doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
      try {
        const bold = await fetchAsBase64(sarabunBoldUrl);
        doc.addFileToVFS('Sarabun-Bold.ttf', bold);
        doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');
      } catch {
        doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'bold');
      }
      doc.setFont('Sarabun', 'normal');
    } catch {
      doc.setFont('helvetica', 'normal');
    }
  }

  async function exportPDF() {
    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      await ensureThaiFont(doc);

      const marginX = 48;
      let y = 56;

      doc.setFontSize(16);
      doc.setFont('Sarabun','bold');
      doc.text('รายงานการจอง (สรุปรายเดือน)', marginX, y);

      doc.setFont('Sarabun','normal');
      doc.setFontSize(11);
      y += 20;
      doc.text(`ช่วงเดือน: ${monthYM}`, marginX, y);
      y += 18;
      doc.text(`จำนวนทั้งหมด: ${monthCount.toLocaleString('th-TH')}  |  ยอดเงิน: ${baht(monthAmount)}`, marginX, y);
      y += 14;

      const head = [['สนาม', 'จอง', 'Walk-in', 'รวมครั้ง', 'ยอดเงิน']];
      const body = rows.map(r => [
        r.courtName,
        r.bookings.toLocaleString('th-TH'),
        r.walkIns.toLocaleString('th-TH'),
        r.total.toLocaleString('th-TH'),
        baht(r.amount)
      ]);

      autoTable(doc, {
        startY: y + 10,
        head,
        body,
        styles: { font: 'Sarabun', fontSize: 11 },
        headStyles: { fillColor: [22, 101, 216] },
        margin: { left: marginX, right: marginX },
        columnStyles: { 1:{halign:'right'}, 2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'right'} }
      });

      doc.save(`report-${monthYM}.pdf`);
    } catch (e:any) {
      alert(`ส่งออก PDF ไม่สำเร็จ: ${e?.message ?? 'unknown error'}`);
    }
  }

  onMount(fetchMonthly);
</script>

<style>
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:12px 14px; margin-bottom:12px; }
  .toolbar { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap }
  .btn { padding:.45rem .7rem; border:1px solid #d1d5db; border-radius:8px; background:#fff; cursor:pointer }
  .btn.primary { background:#2563eb; color:#fff; border-color:#2563eb }
  .muted { color:#6b7280 }
  table { width:100%; border-collapse:collapse }
  th,td { padding:8px; border-top:1px solid #eee; text-align:right }
  th:first-child, td:first-child { text-align:left }
  th { background:#f8fafc }
  tfoot td { background:#f3f4f6; font-weight:700 }
  h3 { margin:0 0 .5rem 0 }
  .right { text-align:right }
</style>

<h2>Reports</h2>

<div class="card toolbar">
  <div>
    <label>เลือกเดือน: </label>
    <input type="month" bind:value={monthYM} />
  </div>
  <button class="btn" on:click={fetchMonthly} disabled={loading}>
    {loading ? 'กำลังดึง…' : 'ดึงเฉพาะเดือนนี้'}
  </button>
  <button class="btn primary" on:click={exportPDF} disabled={loading || rows.length===0}>
    ส่งออก PDF
  </button>
</div>

{#if err}
  <div class="card" style="color:#b91c1c;background:#fff6f6;border-color:#ffdcdc">❌ {err}</div>
{:else}
  <div class="card">
    <h3>สรุปรายเดือน ({monthYM})</h3>
    <div class="muted" style="margin:.25rem 0 .75rem 0">
      จำนวนทั้งหมด: <b>{monthCount.toLocaleString('th-TH')}</b> |
      ยอดเงิน: <b>{(monthAmount||0).toLocaleString('th-TH')} ฿</b>
    </div>

    {#if rows.length === 0}
      <div class="muted">— ไม่มีข้อมูล —</div>
    {:else}
      <!-- ตารางหลัก -->
      <table>
        <thead>
          <tr>
            <th>สนาม</th><th>จอง</th><th>Walk-in</th><th>รวมครั้ง</th><th>ยอดเงิน</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r}
            <tr>
              <td>{r.courtName}</td>
              <td>{r.bookings.toLocaleString('th-TH')}</td>
              <td>{r.walkIns.toLocaleString('th-TH')}</td>
              <td>{r.total.toLocaleString('th-TH')}</td>
              <td>{(r.amount||0).toLocaleString('th-TH')} ฿</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <td>รวมทั้งหมด</td>
            <td>{rows.reduce((s,r)=>s+r.bookings,0).toLocaleString('th-TH')}</td>
            <td>{rows.reduce((s,r)=>s+r.walkIns,0).toLocaleString('th-TH')}</td>
            <td>{rows.reduce((s,r)=>s+r.total,0).toLocaleString('th-TH')}</td>
            <td>{rows.reduce((s,r)=>s+r.amount,0).toLocaleString('th-TH')} ฿</td>
          </tr>
        </tfoot>
      </table>

      <!-- ตารางสรุปยอดเงินตามสนาม -->
      <div style="margin-top:1rem">
        <h3>สรุปยอดเงินตามสนาม</h3>
        <table>
          <thead>
            <tr>
              <th>สนาม</th><th>ยอดเงิน</th><th>สัดส่วน</th>
            </tr>
          </thead>
          <tbody>
            {#each moneyByCourt as m}
              <tr>
                <td>{m.courtName}</td>
                <td class="right">{m.amount.toLocaleString('th-TH')} ฿</td>
                <td class="right">{m.percent.toFixed(1)}%</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
{/if}
