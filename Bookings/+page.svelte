<script lang="ts">
  import { onMount } from 'svelte';

  const API_URL = 'https://demoapi-production-9077.up.railway.app';
  const token = () => localStorage.getItem('token') ?? '';

  type BookingStatus = 'PENDING' | 'APPROVE' | 'REJECTED';

  interface Booking {
    id: number;
    // แสดงผล
    userName?: string | null;
    courtName?: string | null;

    // ฟิลด์คงเดิม
    date: string;
    startTime: string;
    endTime: string;
    status: BookingStatus;
    slipImage?: string | null;
    amount?: number | null;

    // raw (บาง API จะส่งมา)
    user?: { firstName?: string|null; lastName?: string|null; name?: string|null } | null;
    court?: { name?: string|null } | null;
  }

  let bookings: Booking[] = [];
  let search = '';
  let filterStatus: 'ALL' | BookingStatus = 'ALL';

  let loading = false;
  let pageError = '';
  let reading: Record<number, boolean> = {};
  let rowError: Record<number, string> = {};
  let bulkRunning = false;
  let updating: Record<number, boolean> = {};
  let actionError: Record<number, string> = {};

  // helpers
  const z2 = (n:number)=> String(n).padStart(2,'0');
  const hhmm = (v: string) => {
    if (!v) return '--:--';
    if (v.includes('T')) {
      const d = new Date(v);
      return `${z2(d.getHours())}:${z2(d.getMinutes())}`;
    }
    return v.slice(0,5);
  };
  const range = (s:string,e:string)=> `${hhmm(s)} - ${hhmm(e)}`;
  const fmtBaht = (n:number)=> `${n.toLocaleString('th-TH')} ฿`;

  const buildUserName = (b:any) => {
    const fn = (b?.user?.firstName ?? '').trim();
    const ln = (b?.user?.lastName ?? '').trim();
    const full = [fn, ln].filter(Boolean).join(' ');
    return full || b?.user?.name || b?.userName || null;
  };
  const buildCourtName = (b:any) => b?.court?.name ?? b?.courtName ?? null;

  const displayUser = (b: Booking) => b.userName || '-';
  const displayCourt = (b: Booking) => b.courtName || '-';

  async function fetchBookings() {
    loading = true; pageError = '';
    try {
      const res = await fetch(`${API_URL}/api/bookings`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (!res.ok) {
        const t = await res.text().catch(()=>'');
        throw new Error(`HTTP ${res.status}${t ? ` • ${t}` : ''}`);
      }
      const data = await res.json();

      bookings = (Array.isArray(data) ? data : []).map((raw: any) => {
        const mapped: Booking = {
          id: Number(raw.id),
          userName: buildUserName(raw),
          courtName: buildCourtName(raw),
          date: (raw.date ?? '').slice(0,10),
          startTime: String(raw.startTime ?? ''),
          endTime: String(raw.endTime ?? ''),
          status: (String(raw.status ?? 'PENDING').toUpperCase() as BookingStatus),
          slipImage: raw.slipImage ?? null,
          amount: (raw.amount == null || isNaN(Number(raw.amount))) ? null : Number(raw.amount),

          // เก็บ raw ไว้เผื่อใช้ต่อ (ไม่บังคับ)
          user: raw.user ?? null,
          court: raw.court ?? null
        };
        // กันกรณี userName ว่าง ให้ลองสร้างอีกรอบ
        if (!mapped.userName) mapped.userName = buildUserName(mapped);
        if (!mapped.courtName) mapped.courtName = buildCourtName(mapped);
        return mapped;
      });
    } catch(e:any) {
      pageError = e?.message ?? 'โหลดข้อมูลไม่สำเร็จ';
      bookings = [];
    } finally {
      loading = false;
    }
  }

  // OCR ทีละแถว (ส่ง bookingId อย่างเดียว)
  async function readOne(b: Booking) {
    if (!b?.id) return;
    rowError[b.id] = '';
    reading[b.id] = true;
    try {
      const res = await fetch(`${API_URL}/api/payment/ocr-read`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token()}` },
        body: JSON.stringify({ bookingId: b.id })
      });
      if (!res.ok) {
        const t = await res.text().catch(()=> '');
        throw new Error(t || `อ่านสลิปไม่สำเร็จ (HTTP ${res.status})`);
      }
      const data = await res.json().catch(()=> ({}));
      const amount = Number(data?.amount);
      const idx = bookings.findIndex(x=> x.id === b.id);
      if (idx >= 0) {
        bookings[idx] = { ...bookings[idx], amount: Number.isFinite(amount) ? amount : bookings[idx].amount ?? null };
      }
    } catch(e:any) {
      rowError[b.id] = e?.message ?? 'เกิดข้อผิดพลาดในการอ่าน';
    } finally {
      reading[b.id] = false;
    }
  }

  // ดึงยอดเงินที่ยังขาดทั้งหมด (ทีละรายการ)
  async function fillMissingAmountsInRange() {
    if (bulkRunning) return;
    bulkRunning = true;
    try {
      const targets = bookings.filter(b => b.amount == null);
      for (const b of targets) {
        await readOne(b);
        await new Promise(r => setTimeout(r, 250));
      }
    } finally {
      bulkRunning = false;
    }
  }

  // อนุมัติ / ปฏิเสธ
  async function updateStatus(b: Booking, status: 'APPROVE'|'REJECTED') {
    updating[b.id] = true; actionError[b.id] = '';
    const endpoint = status === 'APPROVE' ? '/api/payment/verify-payment' : '/api/payment/reject-payment';
    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token()}` },
        body: JSON.stringify({ bookingId: b.id })
      });
      if (!res.ok) {
        const t = await res.text().catch(()=> '');
        throw new Error(t || `อัปเดตสถานะไม่สำเร็จ (HTTP ${res.status})`);
      }
      await fetchBookings(); // รีเฟรชสถานะหลังทำงานสำเร็จ
    } catch(e:any) {
      actionError[b.id] = e?.message ?? 'อัปเดตสถานะไม่สำเร็จ';
    } finally {
      updating[b.id] = false;
    }
  }

  // กรองแสดงผล
  $: filtered = bookings.filter(b => {
    const matchStatus = filterStatus === 'ALL' || b.status === filterStatus;
    const q = search.trim().toLowerCase();
    const u = displayUser(b).toLowerCase();
    const c = displayCourt(b).toLowerCase();
    return matchStatus && (u.includes(q) || c.includes(q));
  });

  onMount(fetchBookings);
</script>

<style>
  .toolbar { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; }
  .btn { padding:.45rem .6rem; border:1px solid #d1d5db; background:#fff; border-radius:6px; cursor:pointer; }
  .btn.primary { background:#2563eb; color:#fff; border-color:#2563eb }
  .btn.success { background:#10b981; color:#fff; border-color:#10b981 }
  .btn.danger  { background:#ef4444; color:#fff; border-color:#ef4444 }
  .btn:disabled { opacity:.6; cursor:default }

  .muted { color:#6b7280; font-size:.9em; }
  .errbox { background:#fff5f5; color:#b91c1c; border:1px solid #fecaca; padding:.6rem .75rem; border-radius:8px; margin-top:.75rem; }

  .tableWrap { overflow:auto; border-radius:12px; border:1px solid #eee; background:#fff; margin-top:.75rem; }
  table { width:100%; border-collapse:collapse; }
  th, td { border-top:1px solid #f0f0f0; padding:10px; text-align:left; }
  th { background:#fafafa; color:#374151; font-weight:600; }

  .badge { padding:3px 10px; border-radius:999px; font-weight:700; font-size:.85rem; display:inline-block; }
  .APPROVE { background:#10b981; color:#fff }
  .PENDING { background:#f59e0b; color:#111 }
  .REJECTED{ background:#ef4444; color:#fff }

  .link { color:#2563eb; text-decoration:none; }
  .stack { display:flex; gap:.4rem; flex-wrap:wrap; align-items:center; }
</style>

<h2>📋 จัดการคำขอจอง (Admin)</h2>

<div class="toolbar">
  <input type="text" placeholder="ค้นหาผู้ใช้ / สนาม" bind:value={search} />
  <select bind:value={filterStatus}>
    <option value="ALL">ทั้งหมด</option>
    <option value="PENDING">รออนุมัติ</option>
    <option value="APPROVE">อนุมัติแล้ว</option>
    <option value="REJECTED">ปฏิเสธ</option>
  </select>
  <button class="btn" on:click={fetchBookings} disabled={loading}>รีเฟรช</button>
  <button class="btn primary" on:click={fillMissingAmountsInRange} disabled={bulkRunning || loading}>
    {bulkRunning ? 'กำลังกวาดยอด…' : 'ดึงยอดเงินที่ยังขาด'}
  </button>
  {#if loading}<span class="muted">กำลังโหลดรายการ…</span>{/if}
</div>

{#if pageError}
  <div class="errbox">❌ {pageError}</div>
{/if}

<div class="tableWrap">
  <table>
    <thead>
      <tr>
        <th>ผู้ใช้</th>
        <th>สนาม</th>
        <th>วันที่</th>
        <th>เวลา</th>
        <th>สถานะ</th>
        <th>สลิป</th>
        <th>จำนวนเงิน</th>
        <th>จัดการ</th>
      </tr>
    </thead>
    <tbody>
      {#each filtered as b}
        <tr>
          <td>{displayUser(b)}</td>
          <td>{displayCourt(b)}</td>
          <td>{b.date?.slice(0,10)}</td>
          <td>{range(b.startTime, b.endTime)}</td>
          <td><span class={`badge ${b.status}`}>{b.status}</span></td>
          <td>
            {#if b.slipImage}
              <a class="link" href={`${API_URL}/slips/${b.slipImage}`} target="_blank" rel="noopener">ดูสลิป</a>
            {:else}
              <span class="muted">ไม่มี</span>
            {/if}
          </td>
          <td>
            {#if b.amount != null}{fmtBaht(b.amount)}{:else}<span class="muted">ยังไม่มี</span>{/if}
            {#if rowError[b.id]}<div class="muted" style="color:#b91c1c">{rowError[b.id]}</div>{/if}
          </td>
          <td>
            <div class="stack">
              <button class="btn" on:click={() => readOne(b)} disabled={reading[b.id]}>
                {reading[b.id] ? 'กำลังอ่านสลิป…' : 'อ่านสลิป'}
              </button>
              {#if b.status === 'PENDING'}
                <button class="btn success" on:click={() => updateStatus(b, 'APPROVE')} disabled={updating[b.id]}>
                  {updating[b.id] ? 'กำลังอนุมัติ…' : 'อนุมัติ'}
                </button>
                <button class="btn danger" on:click={() => updateStatus(b, 'REJECTED')} disabled={updating[b.id]}>
                  {updating[b.id] ? 'กำลังปฏิเสธ…' : 'ปฏิเสธ'}
                </button>
              {/if}
              {#if actionError[b.id]}<div class="muted" style="color:#b91c1c">{actionError[b.id]}</div>{/if}
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
