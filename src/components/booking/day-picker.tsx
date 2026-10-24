import { useState } from 'react'
import { addMonths, dayOfMonth, monthGrid, monthOf, monthTitle, todayUb, weekdayShort } from '~/lib/booking/calendar'
import type { IsoDate } from '~/lib/booking/calendar'
import { ChevronDown, ChevronLeft, ChevronRight } from './icons'

interface PickerProps {
  /** Every date we have slots for (open or not), in order. */
  dates: IsoDate[]
  /** Dates with at least one free time. */
  open: Set<IsoDate>
  selected: IsoDate | null
  onSelect: (date: IsoDate) => void
}

/**
 * Phone: a row of day squares (Squire's circles, made square) with an arrow
 * that opens the month calendar. Desktop shows only the month calendar —
 * booking.css hides the row there.
 */
export function DayPicker(props: PickerProps) {
  const [expanded, setExpanded] = useState(false)
  // The row starts at today; if the chosen day is further out, start there so
  // it's never hidden.
  const firstShown = props.selected && props.dates.indexOf(props.selected) > 5 ? props.dates.indexOf(props.selected) : 0
  const strip = props.dates.slice(firstShown, firstShown + 6)

  return (
    <div className="bk-days">
      <div className="bk-strip">
        {strip.map((date) => (
          <DaySquare key={date} date={date} {...props} />
        ))}
        <button
          type="button"
          className="bk-strip__more"
          aria-label={expanded ? 'Календарь хаах' : 'Бүх өдрийг харах'}
          aria-expanded={expanded}
          data-open={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ChevronDown />
        </button>
      </div>
      <div className="bk-days__month" data-expanded={expanded}>
        <MonthCalendar {...props} onSelect={(date) => (props.onSelect(date), setExpanded(false))} />
      </div>
    </div>
  )
}

function DaySquare({ date, open, selected, onSelect }: { date: IsoDate } & Omit<PickerProps, 'dates'>) {
  const isOpen = open.has(date)
  const isSelected = date === selected
  const isToday = date === todayUb()
  return (
    <button
      type="button"
      className="bk-day"
      data-selected={isSelected}
      data-open={isOpen}
      disabled={!isOpen}
      onClick={() => onSelect(date)}
      aria-pressed={isSelected}
      aria-label={`${weekdayShort(date)} ${dayOfMonth(date)}${isOpen ? '' : ' — сул цаггүй'}`}
    >
      <span className="bk-day__sq">
        {dayOfMonth(date)}
        {isToday && <i className="bk-day__dot" />}
      </span>
      <span className="bk-day__wd">{weekdayShort(date)}</span>
    </button>
  )
}

/** The month grid from desktop v1: struck-through when closed, a dot when open. */
export function MonthCalendar({ dates, open, selected, onSelect }: PickerProps) {
  const today = todayUb()
  const first = monthOf(dates[0] ?? today)
  const last = monthOf(dates.at(-1) ?? today)
  const [month, setMonth] = useState(() => monthOf(selected ?? first))
  const known = new Set(dates)

  return (
    <div className="bk-cal">
      <div className="bk-cal__head">
        <span className="bk-cal__title">{monthTitle(month)}</span>
        <div className="bk-cal__nav">
          <button type="button" aria-label="Өмнөх сар" disabled={month <= first} onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft />
          </button>
          <button type="button" aria-label="Дараах сар" disabled={month >= last} onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight />
          </button>
        </div>
      </div>
      <div className="bk-cal__grid" role="grid">
        {['Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя', 'Ня'].map((w) => (
          <span key={w} className="bk-cal__wd">
            {w}
          </span>
        ))}
        {monthGrid(month).map((date, i) =>
          date === null ? (
            <span key={`pad-${i}`} />
          ) : (
            <button
              key={date}
              type="button"
              className="bk-cal__day"
              data-state={
                date === selected ? 'selected' : open.has(date) ? 'open' : known.has(date) ? 'closed' : 'out'
              }
              data-today={date === today}
              disabled={!open.has(date)}
              onClick={() => onSelect(date)}
            >
              {dayOfMonth(date)}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
