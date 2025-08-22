<script>
    let users = [
      { id: 1, name: 'User A', status: 'Active' },
      { id: 2, name: 'User B', status: 'Inactive' },
    ];
  </script>
  
  <main>
    <h1>Users</h1>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {#each users as user}
          <tr>
            <td>{user.name}</td>
            <td>{user.status}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </main>
  