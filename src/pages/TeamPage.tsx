import { PageHeader, Card } from '@/components/ui'

export default function TeamPage() {
  const reps = [
    { id: 1, name: 'Alex Johnson', role: 'Field Rep', status: 'Active', leads: 12 },
    { id: 2, name: 'Sarah Miller', role: 'Field Rep', status: 'Active', leads: 8 },
    { id: 3, name: 'Mike Davis', role: 'Senior Rep', status: 'Active', leads: 24 },
  ]

  return (
    <div className="mx-auto max-w-screen-md pb-24 pt-6 animate-in fade-in duration-500">
      <div className="px-3 sm:px-4">
        <PageHeader title="Team Dashboard" description="Manage your team and view performance." />
        <div className="mt-6">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="px-4 py-3 font-semibold text-text-primary">Name</th>
                    <th className="px-4 py-3 font-semibold text-text-primary">Role</th>
                    <th className="px-4 py-3 font-semibold text-text-primary">Status</th>
                    <th className="px-4 py-3 font-semibold text-text-primary">Active Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {reps.map((rep) => (
                    <tr key={rep.id} className="border-b border-border-subtle/50 last:border-0 hover:bg-bg-elevated transition-colors">
                      <td className="px-4 py-3 text-text-primary font-medium">{rep.name}</td>
                      <td className="px-4 py-3 text-text-secondary">{rep.role}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-status-success/10 px-2 py-1 text-xs font-medium text-status-success ring-1 ring-inset ring-status-success/20">
                          {rep.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{rep.leads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
