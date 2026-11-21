import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

type Variant = 'primary' | 'secondary'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:opacity-90',
  secondary: 'border border-gray-300 bg-white text-gray-900 hover:bg-gray-50'
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
