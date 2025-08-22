<script lang="ts">
  type SlotStatus = 'AVAILABLE' | 'BOOKED' | 'MAINTENANCE';
  import { onMount, onDestroy, tick } from 'svelte';
  import { courtList, fetchCourts, initSocket, closeSocket, socket } from '$lib/stores/courtStore';
  import type { Court } from '$lib/types';

  let courts: Court[] = [];
  let selectedCourt: Court | null = null;
  let selectedDate = new Date().toISOString().split('T')[0];
  let timeSlots: any[] = [];
  let message = '';
  let courtName = '';
  const API_URL = "https://demoapi-production-9077.up.railway.app";

  const unsubscribe = courtList.subscribe((value) => {
    courts = value;
  });

  function formatTimeRange(startStr: string, endStr: string) {
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return `${startStr} - ${endStr}`;
    return `${start.getHours()}.00 - ${end.getHours()}.00`;
  }

  async function fetchSlots() {
    if (!selectedCourt || !selectedCourt.id || !selectedDate) {
      console.warn('❌ ยังไม่มีสนามหรือวันที่เลือก');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/courts/${selectedCourt.id}/timeslots`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error(`โหลด TimeSlot ล้มเหลว: ${res.status}`);

      const data = await res.json();
      timeSlots = data
        .filter((slot: any) => slot.startTime.startsWith(selectedDate))
        .sort((a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      message = timeSlots.length === 0 ? "⚠️ ไม่มี TimeSlot สำหรับวันที่เลือก" : '';
    } catch (err) {
      console.error("โหลด TimeSlot ล้มเหลว:", err);
      message = "❌ โหลด TimeSlot ไม่สำเร็จ";
    }
  }

  async function hasSlotForToday(courtId: number, date: string) {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/courts/${courtId}/timeslots`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return false;

    const data = await res.json();
    return data.some((slot: any) => slot.startTime.startsWith(date));
  }

  function onDateChange(event: Event) {
    const target = event.target as HTMLInputElement | null;
    if (target && selectedCourt) {
      selectedDate = target.value;
      fetchSlots();
    }
  }

  async function selectCourt(court: Court) {
    selectedCourt = court;
    courtName = court.name;
    await tick();
    await fetchSlots();
  }

  async function updateCourtName() {
    if (!selectedCourt) {
      alert('กรุณาเลือกสนามก่อน');
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/api/courts/${selectedCourt.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ name: courtName })
      });
      if (!res.ok) throw new Error(`อัปเดตชื่อสนามล้มเหลว: ${res.status}`);
      alert("✅ อัปเดตชื่อสนามสำเร็จ");
      fetchCourts();
    } catch (err) {
      console.error(err);
      alert("❌ อัปเดตชื่อสนามไม่สำเร็จ");
    }
  }

  async function updateSlot(slotId: number, newStatus: SlotStatus) {
  try {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('No token');

    const res = await fetch(`${API_URL}/api/courts/timeslots/${slotId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ status: newStatus })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    await fetchSlots();
    console.log('✅ TimeSlot status updated');
  } catch (err) {
    console.error('❌ Error updating TimeSlot', err);
    alert('อัปเดตสถานะไม่สำเร็จ');
  }
}

async function saveBooking(slotId: number) {
  const slot = timeSlots.find((s) => s.id === slotId);
  if (!slot || !selectedCourt) return;

  // กันกดจองแถวที่ไม่ว่าง
  if (slot.status !== 'AVAILABLE') {
    alert('ช่องเวลานี้ไม่ว่าง (BOOKED/MAINTENANCE) เลือกแถวที่เป็น "AVAILABLE" นะ');
    return;
  }

  // ชื่อผู้จอง/จำนวนคน ต้องมี
  const fullName = (slot.playerName || '').trim();
  const people = Number(slot.people || 0);
  if (!fullName || !people) {
    alert('กรุณากรอกชื่อผู้จองและจำนวนคน');
    return;
  }

  // แปลงเวลาเป็น "HH:mm" ให้ตรงกับสเปก API
  const toHHmm = (iso: string) => {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`; // ex. "09:00"
  };

  const payload = {
    courtId: selectedCourt.id,
    date: selectedDate,                     // "YYYY-MM-DD"
    startTime: toHHmm(slot.startTime),      // ต้องเป็นช่วงที่ระบบมีจริง
    endTime: toHHmm(slot.endTime),
    fullName,
    people
  };

  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/bookings/walkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt);
    }

    // อัปเดตหน้าจอให้ตรงกับของจริง
    await fetchSlots();
    socket?.emit('timeslot-updated', { id: slotId });
    alert('✅ บันทึก Walk-in สำเร็จ');
  } catch (err) {
    console.error('saveBooking error:', err);
    alert('❌ บันทึกไม่สำเร็จ: ' + (err as Error).message);
  }
}


  async function createSlotsForDate() {
    if (!selectedCourt) return;

    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error("No token");

      const formattedDate = selectedDate;

      const alreadyExists = await hasSlotForToday(selectedCourt.id, formattedDate);
      if (alreadyExists) {
        alert("⚠️ TimeSlot สำหรับวันนี้ถูกสร้างไปแล้ว");
        return;
      }

      const res = await fetch(`${API_URL}/api/courts/${selectedCourt.id}/timeslots`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          date: formattedDate,
          startHour: 8,
          endHour: 22
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`❌ HTTP ${res.status} → ${errText}`);
      }

      alert("✅ สร้าง TimeSlot สำเร็จ");
      await fetchSlots();
    } catch (err) {
      alert("❌ สร้าง TimeSlot ไม่สำเร็จ");
      console.error("❌ POST timeslot failed:", err);
    }
  }

  onMount(() => {
    fetchCourts();
    initSocket();
  });

  onDestroy(() => {
    unsubscribe();
    closeSocket();
  });
</script>


<style>
  .court-container { padding: 2rem; font-family: sans-serif; }
  .court-list button {
    margin: 0.25rem; padding: 0.5rem 1rem; background: #2980b9; color: white;
    border: none; border-radius: 4px; cursor: pointer;
  }
  .slot-table { width: 100%; margin-top: 1rem; border-collapse: collapse; }
  .slot-table th, .slot-table td {
    border: 1px solid #ccc; padding: 0.5rem; text-align: center;
  }
</style>

<div class="court-container">
  <h2>จัดการสนาม (Admin)</h2>

  <div class="court-list">
    {#if courts.length > 0}
      {#each courts as court}
        <button on:click={() => selectCourt(court)}>{court.name}</button>
      {/each}
    {:else}
      <p>⏳ กำลังโหลดสนาม...</p>
    {/if}
  </div>

  {#if selectedCourt}
    <h3>ตารางเวลา: {selectedCourt.name}</h3>
    <label>เลือกวันที่:
      <input type="date" bind:value={selectedDate} on:change={onDateChange} />
    </label>
    <button on:click={createSlotsForDate}>➕ สร้าง TimeSlot สำหรับวันนี้</button>

    <div>
      <label>ชื่อสนาม: 
        <input type="text" bind:value={courtName} />
      </label>
      <button on:click={updateCourtName}>💾 บันทึกข้อมูลสนาม</button>
    </div>

    <table class="slot-table">
      <thead>
        <tr>
          <th>เวลา</th>
          <th>สถานะ</th>
          <th>ชื่อผู้จอง</th>
          <th>จำนวนคน</th>
          <th>แก้ไข</th>
          <th>จัดการสถานะ</th>
        </tr>
      </thead>
      <tbody>
        {#each timeSlots as slot}
          <tr>
            <td>{formatTimeRange(slot.startTime, slot.endTime)}</td>
            <td>{slot.status}</td>
            <td>
              <input type="text" bind:value={slot.playerName} />
            </td>
            <td>
              <input type="number" min="1" bind:value={slot.people} />
            </td>
            <td>
              <button on:click={() => saveBooking(slot.id)}>💾</button>
            </td>
            <td>
              <select
  on:change={(e) => {
    const val = (e.target as HTMLSelectElement).value as SlotStatus;
    updateSlot(slot.id, val);
  }}
>
  <option value="AVAILABLE" selected={slot.status === 'AVAILABLE'}>ว่าง</option>
  <option value="BOOKED" selected={slot.status === 'BOOKED'}>จองแล้ว</option>
  <option value="MAINTENANCE" selected={slot.status === 'MAINTENANCE'}>ไม่พร้อม</option>
</select>

            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  {#if message}
    <p>{message}</p>
  {/if}
</div>
