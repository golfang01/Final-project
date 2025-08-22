<!-- <script lang="ts">
  import { onMount } from 'svelte';

  const API_URL = 'https://demoapi-production-9077.up.railway.app';

  type BookingStatus = 'PENDING' | 'APPROVE' | 'REJECTED';

  interface Booking {
    id: number;
    user?: { id?: number; name: string };
    court?: { name: string };
    date: string;              // ISO date
    startTime: string;         // ISO/HH:mm
    endTime: string;           // ISO/HH:mm
    status: BookingStatus;
    slipImage?: string | null; // ชื่อไฟล์สลิป
    amount?: number | null;    // ยอดเงิน (ถ้ามี)
  }

  let bookings: Booking[] = [];
  let filterStatus: 'ALL' | BookingStatus = 'ALL';
  let search = '';
  let filteredBookings: Booking[] = [];
  let reading: Record<number, boolean> = {};   // กำลังอ่านแถวไหนอยู่
  let autoReading = false;                     // state ตอน auto-read

  const token = () => localStorage.getItem('token') ?? '';

  // helpers
  const z2 = (n: number) => String(n).padStart(2, '0');
  const hhmm = (v: string) => {
    if (!v) return '';
    if (v.includes('T')) {
      const d = new Date(v);
      return `${z2(d.getHours())}:${z2(d.getMinutes())}`;
    }
    return v.slice(0, 5);
  };
  const formatTimeRange = (s: string, e: string) => `${hhmm(s)} - ${hhmm(e)}`;
  const fmtBaht = (n: number) => `${n.toLocaleString('th-TH')} ฿`;

  async function fetchBookings() {
    try {
      const res = await fetch(`${API_URL}/api/bookings`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Fetch bookings failed: ${res.status} ${t}`);
      }
      bookings = await res.json();

      // หลังโหลดเสร็จ ลองอ่านยอดเงินให้อัตโนมัติ (เฉพาะรายการที่ยังไม่มี amount แต่มีสลิป)
      ensureAmountsAuto();
    } catch (err) {
      console.error('❌ Load bookings failed', err);
      bookings = [];
      alert('อ่านข้อมูลรายการจองไม่สำเร็จ โปรดตรวจสอบ token/สิทธิ์');
    }
  }

  /** อ่านยอดเงินจากสลิปให้ 1 แถว */
  async function readAmountFromSlip(b: Booking) {
    if (!b?.id) return;
    if (!b?.slipImage) return;

    reading[b.id] = true;
    try {
      const res = await fetch(`${API_URL}/api/payment/ocr-read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`
        },
        body: JSON.stringify({
          imagePath: b.slipImage,   // backend ระบุให้ส่งชื่อไฟล์สลิป
          bookingId: b.id
        })
      });

      if (!res.ok) {
        // ไม่ alert ในโหมดออโต้ เพื่อลดความรก
        const txt = await res.text().catch(() => '');
        throw new Error(`generate-qr failed ${res.status} ${txt}`);
      }

      const data = await res.json();
      const amount = Number(data?.amount);
      const idx = bookings.findIndex(x => x.id === b.id);
      if (idx >= 0) bookings[idx] = { ...bookings[idx], amount: Number.isFinite(amount) ? amount : null };
    } catch (e) {
      console.error('readAmountFromSlip error:', e);
      // ถ้าอยากแจ้งเตือนเฉพาะตอนกดปุ่มเอง (ไม่ใช่ออโต้) ค่อย alert ใน handler ปุ่ม
    } finally {
      reading[b.id] = false;
    }
  }

  /** ยิงอ่านยอดเงินแบบอัตโนมัติ (ทีละรายการ เพื่อไม่ให้ถล่มเซิร์ฟเวอร์) */
  async function ensureAmountsAuto() {
    if (autoReading) return;        // กันซ้ำ
    autoReading = true;

    // เลือกเฉพาะแถวที่ยังไม่มี amount แต่มีสลิป
    const need = bookings.filter(b => b.amount == null && !!b.slipImage);
    for (const b of need) {
      await readAmountFromSlip(b);
      // เว้นจังหวะเล็กน้อยกัน rate limit
      await new Promise(r => setTimeout(r, 150));
    }

    autoReading = false;
  }

  /** อนุมัติ/ปฏิเสธ (ของเดิม) */
  async function updateStatus(id: number | undefined, status: 'APPROVE' | 'REJECTED') {
    if (!id) return;
    const endpoint = status === 'APPROVE'
      ? `/api/payment/verify-payment`
      : `/api/payment/reject-payment`;

    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`
        },
        body: JSON.stringify({ bookingId: id })
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Failed to update: ${res.status} ${text}`);
      }

      await fetchBookings();
    } catch (err) {
      console.error(`❌ Failed to ${status} booking`, err);
      alert(`เปลี่ยนสถานะไม่สำเร็จ: ${status}`);
    }
  }

  // filter เดิม
  $: filteredBookings = bookings.filter(b => {
    const matchStatus = filterStatus === 'ALL' || b.status === filterStatus;
    const q = search.toLowerCase();
    const uname = (b.user?.name ?? '').toLowerCase();
    const cname = (b.court?.name ?? '').toLowerCase();
    return matchStatus && (uname.includes(q) || cname.includes(q));
  });

  onMount(fetchBookings);
</script>

<style>
  .table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  .table th, .table td { border: 1px solid #ccc; padding: 0.5rem; text-align: center; }
  .badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-weight: bold; }
  .APPROVE  { background: #2ecc71; color: #fff; }
  .PENDING  { background: #f39c12; color: #fff; }
  .REJECTED { background: #e74c3c; color: #fff; }
  .actions button { margin: 0 4px; }
  .btn { padding: .25rem .5rem; border: 1px solid #bbb; border-radius: 4px; background: #f6f6f6; cursor: pointer; }
  .muted { color:#888; font-size:.9em; }
</style>

<h2>📋 จัดการคำขอจอง (Admin)</h2>

<div style="margin-bottom: 1rem; display:flex; gap:.5rem; align-items:center">
  <input type="text" placeholder="ค้นหาผู้ใช้ / สนาม" bind:value={search} />
  <select bind:value={filterStatus}>
    <option value="ALL">ทั้งหมด</option>
    <option value="PENDING">รออนุมัติ</option>
    <option value="APPROVE">อนุมัติแล้ว</option>
    <option value="REJECTED">ปฏิเสธ</option>
  </select>
  {#if autoReading}<span class="muted">กำลังอ่านยอดจากสลิปอัตโนมัติ…</span>{/if}
</div>

<table class="table">
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
    {#each filteredBookings as b}
      <tr>
        <td>{b.user?.name}</td>
        <td>{b.court?.name}</td>
        <td>{b.date?.slice(0, 10)}</td>
        <td>{formatTimeRange(b.startTime, b.endTime)}</td>
        <td><span class={`badge ${b.status}`}>{b.status}</span></td>
        <td>
          {#if b.slipImage}
            <a href={`${API_URL}/slips/${b.slipImage}`} target="_blank" rel="noopener noreferrer">ดูสลิป</a>
          {:else}
            -
          {/if}
        </td>
        <td>
          {#if b.amount != null}
            {fmtBaht(b.amount)}
          {:else if b.slipImage}
            <span class="muted">{reading[b.id] ? 'กำลังอ่าน…' : 'กำลังดึงข้อมูล…'}</span>
          {:else}
            -
          {/if}
        </td>
        <td class="actions">
          {#if b.status === 'PENDING' && b.id != null}
            <button title="อนุมัติ" on:click={() => updateStatus(b.id, 'APPROVE')}>✅</button>
            <button title="ปฏิเสธ" on:click={() => updateStatus(b.id, 'REJECTED')}>❌</button>
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table> -->


<script lang="ts">
  import { onMount } from 'svelte';

  const API_URL = 'https://demoapi-production-9077.up.railway.app';

  type BookingStatus = 'PENDING' | 'APPROVE' | 'REJECTED';

  interface Booking {
    id: number;
    user?: { id?: number; name: string };
    court?: { name: string };
    date: string;              // ISO date
    startTime: string;         // ISO/HH:mm
    endTime: string;           // ISO/HH:mm
    status: BookingStatus;
    slipImage?: string | null; // ชื่อไฟล์สลิป
    amount?: number | null;    // ยอดเงิน (ถ้ามี)
  }

  let bookings: Booking[] = [];
  let filterStatus: 'ALL' | BookingStatus = 'ALL';
  let search = '';
  let filteredBookings: Booking[] = [];
  let reading: Record<number, boolean> = {};   // กำลังอ่านแถวไหนอยู่
  let autoReading = false;                     // state ตอน auto-read

  const token = () => localStorage.getItem('token') ?? '';

  // helpers
  const z2 = (n: number) => String(n).padStart(2, '0');
  const hhmm = (v: string) => {
    if (!v) return '';
    if (v.includes('T')) {
      const d = new Date(v);
      return `${z2(d.getHours())}:${z2(d.getMinutes())}`;
    }
    return v.slice(0, 5);
  };
  const formatTimeRange = (s: string, e: string) => `${hhmm(s)} - ${hhmm(e)}`;
  const fmtBaht = (n: number) => `${n.toLocaleString('th-TH')} ฿`;

  async function fetchBookings() {
    try {
      const res = await fetch(`${API_URL}/api/bookings`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Fetch bookings failed: ${res.status} ${t}`);
      }
      bookings = await res.json();

      // หลังโหลดเสร็จ ลองอ่านยอดเงินให้อัตโนมัติ (เฉพาะรายการที่ยังไม่มี amount แต่มีสลิป)
      ensureAmountsAuto();
    } catch (err) {
      console.error('❌ Load bookings failed', err);
      bookings = [];
      alert('อ่านข้อมูลรายการจองไม่สำเร็จ โปรดตรวจสอบ token/สิทธิ์');
    }
  }

  /** ---------- เร่งความเร็ว: worker pool + retry + cache ---------- */

  const sleep = (ms:number)=> new Promise(r=>setTimeout(r, ms));
  const readCache = new Set<number>(); // กันยิงซ้ำในเพจเดียวกัน

  // เรียก OCR 1 รายการ พร้อม retry/backoff เล็กน้อย
  async function ocrReadOnce(b: Booking, attempt=1): Promise<number | null> {
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
        // โดน rate limit หรือ error ชั่วคราว -> retry ได้
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await sleep(300 * attempt);
          return ocrReadOnce(b, attempt + 1);
        }
        return null;
      }

      const data = await res.json();
      const amount = Number(data?.amount);
      return Number.isFinite(amount) ? amount : null;
    } catch {
      if (attempt < 3) {
        await sleep(300 * attempt);
        return ocrReadOnce(b, attempt + 1);
      }
      return null;
    }
  }

  // utility: รันงานแบบจำกัดจำนวน concurrency
  async function processWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
  ) {
    let i = 0;
    const runners = Array.from({ length: limit }).map(async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx]);
      }
    });
    await Promise.all(runners);
  }

  /** ยิงอ่านยอดเงินแบบอัตโนมัติ (คิวขนานจำกัด) */
  async function ensureAmountsAuto() {
    if (autoReading) return;        // กันซ้ำ
    autoReading = true;

    // เลือกเฉพาะแถวที่ยังไม่มี amount แต่มีสลิป และยังไม่เคยอ่านสำเร็จในรอบนี้
    const need = bookings.filter(b => b.amount == null && !!b.slipImage && !readCache.has(b.id));

    // ยิงพร้อมกันสูงสุด 6 รายการ (ปรับได้ตามกำลังฝั่ง BE)
    await processWithConcurrency(need, 6, async (b) => {
      reading[b.id] = true;
      const amount = await ocrReadOnce(b);
      reading[b.id] = false;

      if (amount != null) {
        const idx = bookings.findIndex(x => x.id === b.id);
        if (idx >= 0) bookings[idx] = { ...bookings[idx], amount };
        readCache.add(b.id);
      }
    });

    autoReading = false;
  }

  /** อนุมัติ/ปฏิเสธ (ของเดิม) */
  async function updateStatus(id: number | undefined, status: 'APPROVE' | 'REJECTED') {
    if (!id) return;
    const endpoint = status === 'APPROVE'
      ? `/api/payment/verify-payment`
      : `/api/payment/reject-payment`;

    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`
        },
        body: JSON.stringify({ bookingId: id })
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Failed to update: ${res.status} ${text}`);
      }

      await fetchBookings();
    } catch (err) {
      console.error(`❌ Failed to ${status} booking`, err);
      alert(`เปลี่ยนสถานะไม่สำเร็จ: ${status}`);
    }
  }

  // filter เดิม
  $: filteredBookings = bookings.filter(b => {
    const matchStatus = filterStatus === 'ALL' || b.status === filterStatus;
    const q = search.toLowerCase();
    const uname = (b.user?.name ?? '').toLowerCase();
    const cname = (b.court?.name ?? '').toLowerCase();
    return matchStatus && (uname.includes(q) || cname.includes(q));
  });

  onMount(fetchBookings);
</script>

<style>
  .table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  .table th, .table td { border: 1px solid #ccc; padding: 0.5rem; text-align: center; }
  .badge { padding: 0.25rem 0.5rem; border-radius: 4px; font-weight: bold; }
  .APPROVE  { background: #2ecc71; color: #fff; }
  .PENDING  { background: #f39c12; color: #fff; }
  .REJECTED { background: #e74c3c; color: #fff; }
  .actions button { margin: 0 4px; }
  .btn { padding: .25rem .5rem; border: 1px solid #bbb; border-radius: 4px; background: #f6f6f6; cursor: pointer; }
  .muted { color:#888; font-size:.9em; }
</style>

<h2>📋 จัดการคำขอจอง (Admin)</h2>

<div style="margin-bottom: 1rem; display:flex; gap:.5rem; align-items:center">
  <input type="text" placeholder="ค้นหาผู้ใช้ / สนาม" bind:value={search} />
  <select bind:value={filterStatus}>
    <option value="ALL">ทั้งหมด</option>
    <option value="PENDING">รออนุมัติ</option>
    <option value="APPROVE">อนุมัติแล้ว</option>
    <option value="REJECTED">ปฏิเสธ</option>
  </select>
  {#if autoReading}<span class="muted">กำลังอ่านยอดจากสลิปอัตโนมัติ…</span>{/if}
</div>

<table class="table">
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
    {#each filteredBookings as b}
      <tr>
        <td>{b.user?.name}</td>
        <td>{b.court?.name}</td>
        <td>{b.date?.slice(0, 10)}</td>
        <td>{formatTimeRange(b.startTime, b.endTime)}</td>
        <td><span class={`badge ${b.status}`}>{b.status}</span></td>
        <td>
          {#if b.slipImage}
            <a href={`${API_URL}/slips/${b.slipImage}`} target="_blank" rel="noopener noreferrer">ดูสลิป</a>
          {:else}
            -
          {/if}
        </td>
        <td>
          {#if b.amount != null}
            {fmtBaht(b.amount)}
          {:else if b.slipImage}
            <span class="muted">{reading[b.id] ? 'กำลังอ่าน…' : 'กำลังดึงข้อมูล…'}</span>
          {:else}
            -
          {/if}
        </td>
        <td class="actions">
          {#if b.status === 'PENDING' && b.id != null}
            <button title="อนุมัติ" on:click={() => updateStatus(b.id, 'APPROVE')}>✅</button>
            <button title="ปฏิเสธ" on:click={() => updateStatus(b.id, 'REJECTED')}>❌</button>
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
