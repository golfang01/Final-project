<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let email = '';
  let password = '';
  let message = '';

  async function login() {
    try {
      const res = await fetch('https://demoapi-production-9077.up.railway.app/api/auth/login', {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (res.ok) {
        message = '✅ เข้าสู่ระบบสำเร็จ';
        if (data.token) {
          localStorage.setItem('token', data.token);
          if (data.name) localStorage.setItem('adminName', data.name);

          // ✅ เก็บเวลาหมดอายุ (ถ้ามี expiresIn จาก backend)
          if (data.expiresIn) {
            const expiryTime = Date.now() + data.expiresIn * 1000;
            localStorage.setItem('tokenExpiry', expiryTime.toString());
          } else {
            // ถ้า backend ไม่ส่งมา กำหนดเอง เช่น 1 ชั่วโมง
            const expiryTime = Date.now() + 60 * 60 * 1000;
            localStorage.setItem('tokenExpiry', expiryTime.toString());
          }
        }
        goto('/App/dashboard');
      } else {
        message = `❌ ${data.message || 'เข้าสู่ระบบไม่สำเร็จ'}`;
      }
    } catch (err) {
      message = '❌ เกิดข้อผิดพลาดขณะเชื่อมต่อกับเซิร์ฟเวอร์';
      console.error(err);
    }
  }

  // ✅ ฟังก์ชันดึง token พร้อมตรวจสอบ expiry
  export function getToken(): string | null {
    const token = localStorage.getItem('token');
    const expiry = localStorage.getItem('tokenExpiry');

    if (!token || !expiry) return null;

    if (Date.now() > parseInt(expiry)) {
      // token หมดอายุ
      logout();
      alert("Session หมดอายุ กรุณา login ใหม่");
      return null;
    }

    return token;
  }

  // ✅ Logout logic
  export function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('adminName');
    localStorage.removeItem('tokenExpiry');
    goto('/login');
  }

  // ช่วย debug ในหน้าเว็บ
function decodeJwtPayload(jwt: string) {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    console.log('JWT payload:', payload);    // ดูว่า role มีไหม, exp หมดหรือยัง
    return payload;
  } catch { return null; }
}
// เรียกหลัง login
decodeJwtPayload(localStorage.getItem('token') || '');

</script>

<div class="login-container">
  <h2>เข้าสู่ระบบ</h2>
  <input type="email" placeholder="Email" bind:value={email} />
  <input type="password" placeholder="Password" bind:value={password} />
  <button on:click={login}>เข้าสู่ระบบ</button>
  {#if message}
    <p>{message}</p>
  {/if}
</div>

<style>
  .login-container {
    max-width: 400px;
    margin: 2rem auto;
    padding: 2rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    text-align: center;
  }
  input {
    display: block;
    width: 100%;
    margin: 0.5rem 0;
    padding: 0.5rem;
  }
  button {
    background: #2980b9;
    color: white;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
</style>
