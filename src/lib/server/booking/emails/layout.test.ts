import { describe, expect, it } from 'vitest'
import { localSpan, localStamp, render } from './layout'

describe('booking email layout', () => {
  it('writes times in Ulaanbaatar time', () => {
    expect(localStamp(new Date('2030-01-04T02:00:00Z'))).toBe('2030.01.04 10:00')
    expect(localSpan(new Date('2030-01-04T02:00:00Z'), new Date('2030-01-04T02:45:00Z'))).toBe('2030.01.04 10:00 – 10:45')
  })

  it('escapes whatever the customer typed', () => {
    const { html, text } = render({
      to: { email: 'a@b.c', name: 'x' },
      subject: 's',
      heading: 'Цаг баталгаажлаа',
      headline: '2030.01.04 10:00',
      rows: [['Нэр', '<script>alert(1)</script>']],
      footnote: 'note',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(text).toContain('Нэр: <script>alert(1)</script>') // plain text is not HTML
  })
})
