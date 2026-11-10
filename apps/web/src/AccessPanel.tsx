import type { FormEvent } from "react";
import type { Profile, Role } from "./types";

export default function AccessPanel({
  profiles,
  currentUser,
  canManageRoles,
  busy,
  invite,
  changeRole,
  toggleActive,
}: {
  profiles: Profile[];
  currentUser: string;
  canManageRoles: boolean;
  busy: boolean;
  invite: (email: string, name: string) => void;
  changeRole: (id: string, role: Role) => void;
  toggleActive: (item: Profile) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    invite(String(data.get("email")), String(data.get("name")));
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>User access</h2>
        <span>{profiles.length} accounts</span>
      </div>
      <form className="invite-form" onSubmit={submit}>
        <div>
          <strong>Invite a team member</strong>
          <p>
            New accounts begin as drivers. Assign another role after the
            invitation is accepted.
          </p>
        </div>
        <input
          name="name"
          placeholder="Full name"
          required
          minLength={2}
          aria-label="Full name"
        />
        <input
          name="email"
          type="email"
          placeholder="Email address"
          required
          aria-label="Email address"
        />
        <button className="primary" disabled={busy}>
          Send invite
        </button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>USER</th>
              <th>ROLE</th>
              <th>ACTIVE</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.full_name || "Unnamed user"}</strong>
                  <small>{item.id}</small>
                </td>
                <td>
                  <select
                    aria-label={`Role of ${item.full_name}`}
                    value={item.role}
                    disabled={
                      busy || !canManageRoles || item.id === currentUser
                    }
                    onChange={(event) =>
                      changeRole(item.id, event.target.value as Role)
                    }
                  >
                    <option value="driver">Driver</option>
                    <option value="dispatcher">Dispatcher</option>
                    <option value="fleet_manager">Fleet manager</option>
                    <option value="hr">HR</option>
                    <option value="administrator">Administrator</option>
                    <option value="owner">Owner</option>
                  </select>
                </td>
                <td>
                  <button
                    className="row-action"
                    disabled={
                      busy || !canManageRoles || item.id === currentUser
                    }
                    onClick={() => toggleActive(item)}
                  >
                    {item.active ? "Active" : "Disabled"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
