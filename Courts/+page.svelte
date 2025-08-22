<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  let token: string | null = null;
  let courts: Court[] = [];

  interface Court {
    id: number;
    name: string;
  }

  // ไปหน้ารายละเอียดคอร์ท
  function goToCourtDetail(court: Court) {
    goto(`/App/courts/${court.id}?court=${encodeURIComponent(court.name)}&courtId=${court.id}`);
  }

  onMount(async () => {
    token = localStorage.getItem('token');
    

    if (!token) {
      alert("กรุณาเข้าสู่ระบบ");
      window.location.href = '/login';
      return;
    }

    try {
      const res = await fetch('https://demoapi-production-9077.up.railway.app/api/courts', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) throw new Error('โหลดข้อมูลสนามล้มเหลว');

      const data = await res.json();
      courts = data;
    } catch (err) {
      console.error('โหลดข้อมูลผิดพลาด:', err);
    }
  });
</script>

<style>
  .container {
    max-width: 800px;
    margin: auto;
    padding: 2rem;
    font-family: sans-serif;
  }

  .court-card {
    background-color: #f9f9f9;
    padding: 1rem;
    margin-bottom: 1rem;
    border-radius: 8px;
    border: 1px solid #ddd;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .court-card button {
    background-color: #3498db;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 5px;
    cursor: pointer;
  }
</style>

<div class="container">
  <h2>รายการสนามทั้งหมด</h2>

  {#if courts.length === 0}
    <p>⏳ กำลังโหลดข้อมูลสนาม...</p>
  {:else}
    {#each courts as court}
      <div class="court-card">
        <div>🏸 {court.name}</div>
        <button on:click={() => goToCourtDetail(court)}>ดูรายละเอียด</button>
      </div>
    {/each}
  {/if}
</div>
