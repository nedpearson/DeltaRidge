import { Link } from 'react-router-dom'
import { Empty } from '@/components/ui'

export default function NotFoundPage() {
  return (
    <div className="pt-10">
      <Empty title="Nothing here" body="That page does not exist in the field app." />
      <Link to="/" className="mt-4 block text-center text-sm font-semibold text-brand-300">
        Back to home
      </Link>
    </div>
  )
}
