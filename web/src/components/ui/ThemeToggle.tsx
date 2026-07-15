import { AnimatePresence, motion } from 'motion/react'
import { Moon, Sun } from 'lucide-react'
import { cnm } from '@/utils/style'
import { useTheme } from '@/providers/ThemeProvider'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    toggleTheme(e)
  }

  return (
    <button
      onClick={handleClick}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cnm(
        'w-9 h-9 flex items-center justify-center rounded-full shrink-0',
        'text-slate-400 hover:text-cream-50',
        'hover:bg-white/[0.06]',
        'transition-colors duration-150',
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? 'moon' : 'sun'}
          initial={{ opacity: 0, rotate: -30, scale: 0.7 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 30, scale: 0.7 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          {isDark ? (
            <Moon size={16} strokeWidth={1.75} />
          ) : (
            <Sun size={16} strokeWidth={1.75} />
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
