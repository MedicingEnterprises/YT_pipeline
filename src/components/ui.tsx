import { Children, isValidElement, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { ArrowRight, CircleAlert, LoaderCircle } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  icon?: ReactNode
  iconOnly?: boolean
}

export function Button({
  children,
  className = '',
  variant = 'secondary',
  icon,
  iconOnly = false,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button-${variant}${iconOnly ? ' button-icon-only' : ''} ${className}`}
      {...props}
    >
      {icon}
      {!iconOnly && children}
    </button>
  )
}

export function Card({
  children,
  className = '',
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  return <section className={`card ${className}`} id={id}>{children}</section>
}

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode
  tone?: 'neutral' | 'green' | 'amber' | 'blue' | 'violet' | 'red'
  dot?: boolean
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action && <div className="page-heading-action">{action}</div>}
    </div>
  )
}

export function SectionHeading({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action}
    </div>
  )
}

export function StatCard({
  label,
  value,
  change,
  changeTone = 'positive',
  icon,
  tone = 'violet',
}: {
  label: string
  value: string
  change: string
  changeTone?: 'positive' | 'neutral'
  icon: ReactNode
  tone?: 'violet' | 'green' | 'blue' | 'amber'
}) {
  return (
    <Card className="stat-card">
      <div className={`stat-icon stat-icon-${tone}`}>{icon}</div>
      <div className="stat-copy">
        <p>{label}</p>
        <div className="stat-value-row">
          <strong>{value}</strong>
          <span className={`stat-change${changeTone === 'neutral' ? ' stat-change-neutral' : ''}`}>{change}</span>
        </div>
      </div>
    </Card>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

export function LoadingState({ label = 'Loading your workspace' }: { label?: string }) {
  return (
    <div className="feedback-state" role="status">
      <LoaderCircle size={20} className="spin" />
      <span>{label}</span>
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'We couldn’t load this view. Please try again.',
  onRetry,
}: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <div className="feedback-state feedback-error" role="alert">
      <CircleAlert size={20} />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} icon={<ArrowRight size={15} />}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function Select({
  children,
  className = '',
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const options = Children.toArray(children)
  const missing = props.value !== undefined && !Array.isArray(props.value) && !options.some(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode }>(child) || child.type !== 'option') return false
    return String(child.props.value ?? child.props.children) === String(props.value)
  })
  return (
    <select className={`select ${className}`} {...props} aria-invalid={missing || props['aria-invalid']}>
      {missing && <option value={String(props.value)} disabled>Unavailable selection — choose another</option>}
      {children}
    </select>
  )
}

export function Avatar({
  initials,
  className = '',
}: {
  initials: string
  className?: string
}) {
  return <span className={`avatar ${className}`}>{initials}</span>
}
