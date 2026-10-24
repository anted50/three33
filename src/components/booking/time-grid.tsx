import { isEvening, slotTime } from '~/lib/booking/calendar'
import { MoonIcon, SunIcon } from './icons'

/** Free start times as square cards, sun before 18:00 and moon after. */
export function TimeGrid({ slots, selected, onSelect }: { slots: string[]; selected: string | null; onSelect: (slot: string) => void }) {
  return (
    <div className="bk-times">
      {slots.map((slot) => {
        const on = selected !== null && new Date(slot).getTime() === new Date(selected).getTime()
        return (
          <button key={slot} type="button" className="bk-time" data-selected={on} aria-pressed={on} onClick={() => onSelect(slot)}>
            {isEvening(slot) ? <MoonIcon /> : <SunIcon />}
            {slotTime(slot)}
          </button>
        )
      })}
    </div>
  )
}
