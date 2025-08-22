<script>
  export let data;
</script>

<main class="auth-layout">
  <slot />
</main>

<style>
  .auth-layout {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    background: #f5f5f5;
  }
</style>
