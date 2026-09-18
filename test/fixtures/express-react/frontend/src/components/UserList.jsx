import React from 'react';
import { fetchUsers } from '../api/users';

function UserList() {
  const users = fetchUsers();
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}

export default UserList;
