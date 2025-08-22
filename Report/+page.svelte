<script lang="ts">
  import { onMount } from 'svelte';
  import jsPDF from 'jspdf';
  // @ts-ignore
  import autoTable from 'jspdf-autotable';

  const API_URL = 'https://demoapi-production-9077.up.railway.app';

  type BookingStatus = 'PENDING' | 'APPROVE' | 'REJECTED';
  interface Booking {
    id: number;
    date: string;          // ISO e.g. 2025-08-31
    startTime: string;     // ISO datetime
    endTime: string;       // ISO datetime
    status: BookingStatus;
    amount?: number | null;
  }

  let bookings: Booking[] = [];
  let loading = true;
  let err = '';

  // ช่วงวันที่เริ่มต้นเป็นเดือนนี้
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const pad2 = (n:number)=> String(n).padStart(2,'0');

  let startDate = `${y}-${pad2(m+1)}-01`;
  let endDate   = `${y}-${pad2(m+1)}-${pad2(new Date(y, m+1, 0).getDate())}`;

  const toYMD = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const fmtBaht = (n:number)=> `${n.toLocaleString('th-TH')} ฿`;
  const inRange = (ymd: string) => ymd >= startDate && ymd <= endDate;

  async function fetchBookings() {
    loading = true; err = '';
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('no token');
      const res = await fetch(`${API_URL}/api/bookings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bookings = await res.json();
    } catch(e:any) {
      err = e?.message ?? 'โหลดข้อมูลล้มเหลว';
      bookings = [];
    } finally {
      loading = false;
    }
  }

  // group รายวันเฉพาะในช่วง และนับเฉพาะที่อนุมัติแล้วสำหรับยอดเงิน
  $: grouped = (() => {
    const map = new Map<string, {total:number, count:number}>();
    for (const b of bookings) {
      const ymd = (b.date?.slice(0,10)) || '';
      if (!ymd || !inRange(ymd)) continue;

      const rec = map.get(ymd) ?? { total:0, count:0 };
      // จำนวนนับทุกสถานะ (ให้เห็นจำนวน booking ทั้งหมด)
      rec.count += 1;
      // ยอดเงินนับเฉพาะ APPROVE
      if (b.status === 'APPROVE') rec.total += Number(b.amount ?? 0) || 0;
      map.set(ymd, rec);
    }
    // แปลงเป็น array เรียงตามวันที่
    return Array.from(map.entries())
      .sort((a,b)=> a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, total: v.total, count: v.count }));
  })();

  $: grandTotal = grouped.reduce((s, r)=> s + r.total, 0);
  $: grandCount = grouped.reduce((s, r)=> s + r.count, 0);

  // ---- PDF helpers ----

  async function fetchAsBase64(url: string) {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    // @ts-ignore
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  // ฝังฟอนต์ไทยเข้า jsPDF runtime
  async function ensureThaiFont(doc: jsPDF) {
    // โหลดครั้งเดียวพอ
    if ((doc as any).__thaiLoaded) return;

    const regularB64 = await fetchAsBase64('/fonts/Sarabun-Regular.ttf');
    const boldB64    = await fetchAsBase64('/fonts/Sarabun-Bold.ttf');

    doc.addFileToVFS('Sarabun-Regular.ttf', regularB64);
    doc.addFileToVFS('Sarabun-Bold.ttf', boldB64);
    doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
    doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');
    (doc as any).__thaiLoaded = true;
  }

  async function exportPDF() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    await ensureThaiFont(doc);
    doc.setFont('Sarabun', 'bold');
    doc.setFontSize(14);

    const title = 'รายงานการจอง (สรุปรายวัน)';
    doc.text(title, 40, 40);
    doc.setFont('Sarabun', 'normal');
    doc.setFontSize(11);
    doc.text(`ช่วงวันที่: ${startDate} ถึง ${endDate}`, 40, 60);

    // ตาราง
    const head = [['วันที่', 'ยอดเงิน (฿)', 'จำนวนการจอง']];
    const body = grouped.map(r => [r.date, r.total.toLocaleString('th-TH'), r.count.toString()]);
    // @ts-ignore
    autoTable(doc, {
      head, body,
      startY: 80,
      styles: { font: 'Sarabun', fontSize: 11 },
      headStyles: { fillColor: [21, 101, 192], textColor: 255 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      theme: 'striped'
    });

    // สรุปท้าย
    let y = (doc as any).lastAutoTable?.finalY ?? 100;
    y += 20;
    doc.setFont('Sarabun','bold');
    doc.text(`รวมทั้งสิ้น: ${grandTotal.toLocaleString('th-TH')} ฿   |   จำนวนการจอง: ${grandCount.toLocaleString('th-TH')}`, 40, y);

    doc.save('report.pdf');
  }

  onMount(fetchBookings);
</script>

<style>
  .card { background:#fff; border:1px solid #eee; border-radius:10px; padding:1rem; }
  table { width:100%; border-collapse:collapse; margin-top:.5rem }
  th, td { border-top:1px solid #eee; padding:.5rem .6rem; text-align:left }
  th { background:#fafafa }
  .right { text-align:right }
  .grid { display:grid; gap:1rem; grid-template-columns: 1fr 1fr; }
</style>

<h2>📄 Reports</h2>

<div class="card" style="display:flex; gap:.5rem; align-items:center; flex-wrap:wrap">
  <div>
    <label>วันที่เริ่ม: </label>
    <input type="date" bind:value={startDate} />
  </div>
  <div>
    <label>ถึง: </label>
    <input type="date" bind:value={endDate} />
  </div>
  <button on:click={exportPDF}>ส่งออก PDF</button>
</div>

{#if loading}
  <div class="card">กำลังโหลดข้อมูล…</div>
{:else if err}
  <div class="card" style="color:#b91c1c;background:#fff6f6;border-color:#ffdcdc">❌ {err}</div>
{:else}
  <div class="card">
    <strong>สรุปรายวัน</strong>
    <table>
      <thead>
        <tr>
          <th>วันที่</th>
          <th class="right">ยอดเงิน (฿)</th>
          <th class="right">จำนวนการจอง</th>
        </tr>
      </thead>
      <tbody>
        {#each grouped as r}
          <tr>
            <td>{r.date}</td>
            <td class="right">{r.total.toLocaleString('th-TH')}</td>
            <td class="right">{r.count.toLocaleString('th-TH')}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <th>รวม</th>
          <th class="right">{grandTotal.toLocaleString('th-TH')}</th>
          <th class="right">{grandCount.toLocaleString('th-TH')}</th>
        </tr>
      </tfoot>
    </table>
  </div>
{/if}
