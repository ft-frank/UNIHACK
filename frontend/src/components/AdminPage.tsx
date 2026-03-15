type AdminUserProgress = {
  totalQuestions: number;
  correctAnswers: number;
  accuracy: number | null;
  proficiencyLevel: string;
  lastUpdated?: string | null;
};

export type AdminUserRecord = {
  id: string;
  email?: string | null;
  username: string;
  isAdmin: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  historyCount: number;
  questionResultCount: number;
  progress: AdminUserProgress;
};

export type AdminSummary = {
  totalUsers: number;
  adminUsers: number;
  totalSessions: number;
  totalQuestionResults: number;
};

type AdminPageProps = {
  isDarkMode: boolean;
  currentUserId: string;
  summary: AdminSummary | null;
  users: AdminUserRecord[];
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onToggleRole: (userId: string, nextIsAdmin: boolean) => Promise<void>;
  onResetUserData: (userId: string) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

export default function AdminPage({
  isDarkMode,
  currentUserId,
  summary,
  users,
  loading,
  error,
  onRefresh,
  onToggleRole,
  onResetUserData,
  onDeleteUser,
}: AdminPageProps) {
  return (
    <div className="space-y-8">
      <section className={`rounded-[28px] border p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] ${isDarkMode ? "border-slate-800 bg-slate-900/75" : "border-slate-200 bg-white/90"}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className={`text-sm font-semibold uppercase tracking-[0.24em] ${isDarkMode ? "text-amber-300" : "text-amber-700"}`}>
              Administrator
            </p>
            <h2 className={`mt-2 text-3xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>
              Manage users, roles, and saved learning data
            </h2>
            <p className={`mt-3 max-w-3xl text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
              Admin access is granted to accounts whose email appears in the backend `ADMIN_EMAILS` setting, and admins can also promote additional accounts from here.
            </p>
          </div>
          <button
            onClick={() => void onRefresh()}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${isDarkMode ? "border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            Refresh
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          isDarkMode={isDarkMode}
          label="Users"
          value={summary ? `${summary.totalUsers}` : "0"}
          detail="Profiles in the system"
        />
        <AdminStatCard
          isDarkMode={isDarkMode}
          label="Administrators"
          value={summary ? `${summary.adminUsers}` : "0"}
          detail="Accounts with elevated access"
        />
        <AdminStatCard
          isDarkMode={isDarkMode}
          label="Saved sessions"
          value={summary ? `${summary.totalSessions}` : "0"}
          detail="Total completion history rows"
        />
        <AdminStatCard
          isDarkMode={isDarkMode}
          label="Question results"
          value={summary ? `${summary.totalQuestionResults}` : "0"}
          detail="Saved answer records"
        />
      </section>

      {error && (
        <section className={`rounded-[24px] border px-5 py-4 text-sm ${isDarkMode ? "border-rose-900 bg-rose-950/30 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {error}
        </section>
      )}

      <section className={`rounded-[28px] border p-6 shadow-sm ${isDarkMode ? "border-slate-800 bg-slate-900/75" : "border-slate-200 bg-white/90"}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className={`text-xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>User accounts</h3>
            <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
              Promote or demote admins, reset saved learning data, or remove an account entirely.
            </p>
          </div>
          {loading && <p className={`text-sm ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Loading...</p>}
        </div>

        <div className="mt-6 space-y-4">
          {users.map((user) => {
            const accuracy = user.progress.accuracy === null
              ? "No attempts"
              : `${Math.round(user.progress.accuracy * 100)}%`;

            return (
              <article
                key={user.id}
                className={`rounded-[24px] border p-5 ${isDarkMode ? "border-slate-700 bg-slate-800/60" : "border-slate-200 bg-slate-50/80"}`}
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className={`text-lg font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{user.username}</h4>
                      {user.isAdmin && (
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isDarkMode ? "bg-amber-950 text-amber-300" : "bg-amber-100 text-amber-700"}`}>
                          Admin
                        </span>
                      )}
                      {user.id === currentUserId && (
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isDarkMode ? "bg-sky-950 text-sky-300" : "bg-sky-100 text-sky-700"}`}>
                          You
                        </span>
                      )}
                    </div>
                    <p className={`mt-1 text-sm ${isDarkMode ? "text-slate-300" : "text-slate-700"}`}>{user.email || "No email stored"}</p>
                    <div className={`mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4 ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>
                      <p>Joined: {formatDateTime(user.createdAt)}</p>
                      <p>Updated: {formatDateTime(user.updatedAt)}</p>
                      <p>Sessions: {user.historyCount}</p>
                      <p>Results: {user.questionResultCount}</p>
                      <p>Questions answered: {user.progress.totalQuestions}</p>
                      <p>Correct answers: {user.progress.correctAnswers}</p>
                      <p>Accuracy: {accuracy}</p>
                      <p>Level: {user.progress.proficiencyLevel}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 xl:max-w-sm xl:justify-end">
                    <button
                      onClick={() => {
                        const action = user.isAdmin ? "remove admin access from" : "grant admin access to";
                        if (window.confirm(`Do you want to ${action} ${user.username}?`)) {
                          void onToggleRole(user.id, !user.isAdmin);
                        }
                      }}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${isDarkMode ? "border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                    >
                      {user.isAdmin ? "Remove admin" : "Make admin"}
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Reset saved history, question results, and progress for ${user.username}?`)) {
                          void onResetUserData(user.id);
                        }
                      }}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${isDarkMode ? "border-amber-800 bg-amber-950/40 text-amber-200 hover:bg-amber-950/60" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"}`}
                    >
                      Reset data
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete ${user.username}'s account and all related data? This cannot be undone.`)) {
                          void onDeleteUser(user.id);
                        }
                      }}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${isDarkMode ? "border-rose-800 bg-rose-950/40 text-rose-200 hover:bg-rose-950/60" : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"}`}
                    >
                      Delete account
                    </button>
                  </div>
                </div>
              </article>
            );
          })}

          {!loading && users.length === 0 && (
            <div className={`rounded-[24px] border border-dashed p-10 text-center ${isDarkMode ? "border-slate-700 bg-slate-900/65 text-slate-300" : "border-slate-300 bg-slate-50 text-slate-600"}`}>
              No user profiles found.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AdminStatCard({
  isDarkMode,
  label,
  value,
  detail,
}: {
  isDarkMode: boolean;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className={`rounded-[24px] border p-5 shadow-sm ${isDarkMode ? "border-slate-800 bg-slate-900/75" : "border-slate-200 bg-white/90"}`}>
      <p className={`text-sm font-semibold ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>{label}</p>
      <p className={`mt-3 text-3xl font-bold ${isDarkMode ? "text-slate-100" : "text-slate-900"}`}>{value}</p>
      <p className={`mt-2 text-sm ${isDarkMode ? "text-slate-400" : "text-slate-600"}`}>{detail}</p>
    </div>
  );
}
