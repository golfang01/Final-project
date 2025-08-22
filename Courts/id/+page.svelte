<!-- <script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';

  const API_URL = 'https://demoapi-production-9077.up.railway.app';

  type SlotStatus = 'AVAILABLE' | 'BOOKED' | 'MAINTENANCE';
  interface TimeSlot {
    id: number;
    courtId: number;
    startTime: string;
    endTime: string;
    status: SlotStatus;
    playerName?: string | null;
    fullName?: string | null;
    people?: number | null;
  }

  let courtId = 0;
  let selectedDate = new Date().toISOString().slice(0, 10);
  let slots: TimeSlot[] = [];
  let loading = false;
  let errMsg = '';

  const token = () => localStorage.getItem('token') ?? '';

  const hhmm = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const badge = (s: SlotStatus) =>
    s === 'BOOKED' ? 'badge booked' : s === 'MAINTENANCE' ? 'badge maint' : 'badge ok';

  async function fetchTimeSlotsForDate() {
    // ส่ง courtId และ date ให้ครบตาม backend ต้องการ
    const url = `${API_URL}/api/courts/${courtId}/timeslots?date=${selectedDate}&courtId=${courtId}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });

    if (!res.ok) {
      const t = await res.text().catch(()=>'');
      throw new Error(`timeslots HTTP ${res.status}${t ? ` – ${t}` : ''}`);
    }

    const data: TimeSlot[] = await res.json();

    return data
      .filter(s => s.startTime?.startsWith(selectedDate))
      .sort((a,b) => +new Date(a.startTime) - +new Date(b.startTime));
  }

  async function load() {
    if (!courtId) return;
    loading = true; errMsg = ''; slots = [];
    try {
      slots = await fetchTimeSlotsForDate();
    } catch (e: any) {
      console.error(e);
      errMsg = e?.message || 'โหลดข้อมูลล้มเหลว';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    const qp = new URLSearchParams(window.location.search);
    courtId = Number(qp.get('courtId') || $page.params.id || 0) || 1;
    load();
  });

  $: selectedDate, load();
</script>

<style>
  .toolbar { display:flex; align-items:center; gap:.75rem; margin:12px 0; }
  .table { width:100%; border-collapse:collapse; }
  .table th, .table td { border:1px solid #e6e6e6; padding:.6rem .8rem; }
  .table thead th { background:#f7f9fb; text-align:left; }
  .muted { color:#9aa4b2; }
  .error { color:#c92a2a; font-weight:600; margin:.5rem 0; }
  .badge { padding:.15rem .5rem; border-radius:6px; font-weight:700; font-size:.8rem; display:inline-block; }
  .badge.ok { background:#e9f9ef; color:#1a7f37; }
  .badge.booked { background:#fff2e6; color:#b35300; }
  .badge.maint { background:#ffe6ea; color:#b3002a; }
</style>

<h2>📋 สถานะสนาม (เช็คว่าง / มีคนเล่น)</h2>

<div class="toolbar">
  <label for="d">เลือกวันที่:</label>
  <input id="d" type="date" bind:value={selectedDate} />
</div>

{#if loading}
  <p class="muted">กำลังโหลดข้อมูล…</p>
{:else}
  {#if errMsg}
    <p class="error">✗ {errMsg}</p>
  {/if}

  <table class="table">
    <thead>
      <tr>
        <th style="width:160px;">เวลา</th>
        <th style="width:140px;">สถานะ</th>
        <th>ชื่อผู้จอง</th>
      </tr>
    </thead>
    <tbody>
      {#if slots.length === 0}
        <tr><td colspan="3" class="muted">— ไม่มีข้อมูลสำหรับวันที่ดังกล่าว —</td></tr>
      {:else}
        {#each slots as s}
          <tr>
            <td>{hhmm(s.startTime)} - {hhmm(s.endTime)}</td>
            <td><span class={badge(s.status)}>{s.status}</span></td>
            <td>
              {#if s.status === 'BOOKED'}
                {s.fullName || s.playerName || '-'}
                {#if s.people} (จำนวน {s.people}){/if}
              {:else}
                -
              {/if}
            </td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
{/if} -->

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import io from 'socket.io-client';

  const API_URL = 'https://demoapi-production-9077.up.railway.app';

  type Status = 'AVAILABLE' | 'BOOKED' | 'MAINTENANCE';
  type Row = { start: string; end: string; status: Status; name?: string | null; people?: number | null };

  let courtId = 0;
  let selectedDate = new Date().toISOString().slice(0, 10);
  let courtLabel = '';
  let rows: Row[] = [];
  let loading = false;
  let err = '';

  const token = () => localStorage.getItem('token') ?? '';

  // utils
  const toHHMM = (v: string) => v?.slice(0, 5);
  const keyOf = (r: { start: string; end: string }) => `${r.start}-${r.end}`;

  // ตารางเปล่า 08–22
  const skeleton = () => {
    const out: Row[] = [];
    for (let h = 8; h < 22; h++) out.push({
      start: `${String(h).padStart(2, '0')}:00`,
      end: `${String(h + 1).padStart(2, '0')}:00`,
      status: 'AVAILABLE'
    });
    return out;
  };

  async function fetchCourtName() {
    try {
      const res = await fetch(`${API_URL}/api/courts`, { headers: { Authorization: `Bearer ${token()}` } });
      if (res.ok) {
        const list = await res.json();
        courtLabel = `สนาม ${list.find((c: any) => +c.id === +courtId)?.name ?? courtId}`;
      } else courtLabel = `สนาม ${courtId}`;
    } catch { courtLabel = `สนาม ${courtId}`; }
  }

  // --------- ใช้ endpoint 2.9: /api/courts/available ----------
  async function fetchAvailable() {
  loading = true; err = ''; rows = [];

  const q = new URLSearchParams({
    date: selectedDate,           // 2025-08-31
    startTime: '08:00',           // ตามคู่มือ 2.9
    endTime: '24:00',             // ถ้า BE ไม่บังคับ จะมีหรือไม่มีก็ได้
    courtId: String(courtId)      // ← สำคัญ! ต้องส่ง
  });

  try {
    const res = await fetch(`${API_URL}/api/courts/available?${q}`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    if (res.status === 204) { rows = skeleton(); return; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data: any = await res.json();

    // โครงสร้าง 2.9 จากรูป: [{ courts: [ { id, name, slots: [...] } ] }]
    // เผื่อ BE เปลี่ยนเล็กน้อย เรา normalize แบบยืดหยุ่นไว้
    const courtnest =
      Array.isArray(data) ? data[0]?.courts
      : Array.isArray(data?.courts) ? data.courts
      : [];

    // เลือก court ตาม courtId (ถ้าไม่มีให้เอาตัวแรก)
    const court = courtnest.find((c: any) => Number(c.id) === Number(courtId)) ?? courtnest[0];

    // อัปเดต label บนหัวตาราง
    if (court) courtLabel = `สนาม ${court.name ?? courtId}`;

    const slots = Array.isArray(court?.slots) ? court.slots : [];

    rows = (slots.length ? slots : []).map((s: any) => ({
      start: String(s.startTime).slice(0,5),
      end:   String(s.endTime).slice(0,5),
      status: (s.status ?? 'AVAILABLE') as Status,
      // ชื่อจะโชว์เฉพาะที่ BE ส่งมาในฟิลด์ bookedBy
      name: s.bookedBy ?? null,
      people: s.people ?? null
    }))
    rows = rows.sort((a: Row, b: Row) => a.start.localeCompare(b.start));

    if (!rows.length) rows = skeleton();
  } catch (e: any) {
    console.error('available error:', e);
    err = e?.message || String(e);
    rows = skeleton();
  } finally {
    loading = false;
  }
}

  // --------- realtime ผ่าน socket.io ----------
  let socket: ReturnType<typeof io> | null = null;

  function connectSocket() {
    socket = io(API_URL, { transports: ['websocket'] });

    // เข้าห้องตามคอร์ท+วันที่ (ฝั่ง backend ควรสร้าง room ชื่อเช่น court:1:2025-08-31)
    socket.emit('join-court-date', { courtId, date: selectedDate });

    // เมื่อมีการเปลี่ยน timeslot ที่ court/date นี้ ให้ส่ง payload นี้มา
    // payload ควรเป็น { courtId, date, startTime, endTime, status, bookedBy, people }
    socket.on('timeslot-updated', (p: any) => {
      if (+p.courtId !== +courtId || p.date !== selectedDate) return;

      const k = `${toHHMM(p.startTime)}-${toHHMM(p.endTime)}`;
      const i = rows.findIndex(r => keyOf(r) === k);

      if (i >= 0) {
        rows[i] = {
          start: toHHMM(p.startTime),
          end: toHHMM(p.endTime),
          status: (p.status ?? 'AVAILABLE') as Status,
          name: p.bookedBy ?? p.fullName ?? p.playerName ?? null,
          people: p.people ?? null
        };
        rows = [...rows]; // trigger update
      } else {
        // เผื่อกรณีช่องเวลาไม่อยู่ในสเกล — refetch ทั้งตาราง
        fetchAvailable();
      }
    });

    // สำรอง: ถ้า backend broadcast ว่า “มีการปรับปรุงตารางทั้งวัน”
    socket.on('available-reloaded', (info: any) => {
      if (+info.courtId === +courtId && info.date === selectedDate) fetchAvailable();
    });
  }

  onMount(async () => {
    const qp = new URLSearchParams(window.location.search);
    courtId = Number(qp.get('courtId') || qp.get('id') || 0) || 1;

    await fetchCourtName();
    await fetchAvailable();
    connectSocket();
  });

  // เปลี่ยนวันที่ = ออกจากห้องเก่า แล้วเข้าห้องใหม่ + refetch
  $: if (socket) {
    socket.emit('join-court-date', { courtId, date: selectedDate });
    // ดึงข้อมูลตามวันที่ใหม่
    fetchAvailable();
  }

  onDestroy(() => { socket?.disconnect(); });
</script>

<style>
  .toolbar{display:flex;gap:.75rem;align-items:center;margin:12px 0}
  .muted{color:#9aa4b2}
  .err{color:#c92a2a;font-weight:600;margin:.5rem 0}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #e6e6e6;padding:.6rem .8rem}
  thead th{background:#f7f9fb;text-align:left}
  .badge{padding:.15rem .5rem;border-radius:6px;font-weight:700;font-size:.8rem;display:inline-block}
  .ok{background:#e9f9ef;color:#1a7f37}
  .booked{background:#fff2e6;color:#b35300}
  .maint{background:#ffe6ea;color:#b3002a}
</style>

<h2>📋 สถานะสนาม (เช็คว่าง / มีคนเล่น)</h2>

<div class="toolbar">
  <label for="d">เลือกวันที่:</label>
  <input id="d" type="date" bind:value={selectedDate} />
  {#if courtLabel}<span class="muted">— {courtLabel}</span>{/if}
</div>

{#if loading}
  <p class="muted">กำลังโหลดข้อมูล…</p>
{:else}
  {#if err}<p class="err">✗ {err}</p>{/if}
  <table>
    <thead>
      <tr>
        <th style="width:160px;">เวลา</th>
        <th style="width:140px;">สถานะ</th>
        <th>ชื่อผู้จอง</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r}
        <tr>
          <td>{r.start} - {r.end}</td>
          <td>
            <span class={"badge " + (r.status==='BOOKED'?'booked':r.status==='MAINTENANCE'?'maint':'ok')}>
              {r.status}
            </span>
          </td>
          <td>{r.status==='BOOKED' ? (r.name ?? '-') : '-'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

