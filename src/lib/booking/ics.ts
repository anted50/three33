import { SHOP } from './shop'

/**
 * "Add to calendar": a one-event .ics file. Every calendar app on a phone
 * opens it, which no single "add to Google Calendar" link can claim.
 */

/** 20261029T063000Z — iCalendar's UTC form. */
function icsInstant(instant: string): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Commas, semicolons and backslashes are syntax in iCalendar text. */
function icsText(text: string): string {
  return text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')
}

export function bookingIcs(booking: { bookingNo: string; service: string; startsAt: string; endsAt: string }, now = new Date()): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Three33 Barber//Booking//MN',
    'BEGIN:VEVENT',
    `UID:${booking.bookingNo}@three33barber`,
    `DTSTAMP:${icsInstant(now.toISOString())}`,
    `DTSTART:${icsInstant(booking.startsAt)}`,
    `DTEND:${icsInstant(booking.endsAt)}`,
    `SUMMARY:${icsText(`${SHOP.name} — ${booking.service}`)}`,
    `LOCATION:${icsText(`${SHOP.address}, ${SHOP.district}`)}`,
    `DESCRIPTION:${icsText(`Захиалга № ${booking.bookingNo}. Өөрчлөх бол ${SHOP.phone}.`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

/** Hands the file to the browser, which offers it to the calendar app. */
export function downloadIcs(filename: string, ics: string): void {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
