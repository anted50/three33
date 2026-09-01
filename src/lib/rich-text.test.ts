import { describe, expect, it } from 'vitest'
import {
  plainTextToHtml,
  richTextToPlain,
  sanitizeRichText,
  toRichHtml,
} from './rich-text'

describe('sanitizeRichText', () => {
  it('keeps the formatting the editor produces', () => {
    expect(
      sanitizeRichText('<p>Эрчимтэй <strong>барих</strong> тос</p>'),
    ).toBe('<p>Эрчимтэй <strong>барих</strong> тос</p>')
    expect(sanitizeRichText('<ul><li>30g</li><li>70g</li></ul>')).toBe(
      '<ul><li>30g</li><li>70g</li></ul>',
    )
  })

  it('normalises presentational tags to their meaning', () => {
    expect(sanitizeRichText('<div><b>Тод</b> <i>налуу</i></div>')).toBe(
      '<p><strong>Тод</strong> <em>налуу</em></p>',
    )
  })

  it('drops scripts along with their contents', () => {
    expect(sanitizeRichText('<p>a</p><script>alert(1)</script><p>b</p>')).toBe(
      '<p>a</p><p>b</p>',
    )
  })

  it('strips attributes, including event handlers', () => {
    expect(sanitizeRichText('<p onclick="steal()" style="color:red">hi</p>')).toBe(
      '<p>hi</p>',
    )
  })

  it('leaves entities the editor wrote alone', () => {
    // The editor serialises a non-breaking space as an entity; escaping its
    // ampersand would print "&nbsp;" to shoppers.
    expect(sanitizeRichText('<p>30&nbsp;g &amp; 70&nbsp;g</p>')).toBe(
      '<p>30&nbsp;g &amp; 70&nbsp;g</p>',
    )
    expect(sanitizeRichText('<p>Tom & Jerry</p>')).toBe('<p>Tom &amp; Jerry</p>')
  })

  it('escapes text that only looks like markup', () => {
    expect(sanitizeRichText('<p>5 < 10 & "quoted"</p>')).toBe(
      '<p>5 &lt; 10 &amp; &quot;quoted&quot;</p>',
    )
  })

  it('keeps http links but not javascript ones', () => {
    expect(sanitizeRichText('<a href="https://uppercut.mn">shop</a>')).toBe(
      '<a href="https://uppercut.mn" rel="noopener noreferrer" target="_blank">shop</a>',
    )
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).toBe('x')
    // Entity- and control-character-encoded spellings of the same scheme.
    expect(sanitizeRichText('<a href="java&#09;script:alert(1)">x</a>')).toBe('x')
    expect(sanitizeRichText('<a href="&#106;avascript:alert(1)">x</a>')).toBe('x')
  })

  it('balances the tags it emits', () => {
    expect(sanitizeRichText('<p><strong>open')).toBe('<p><strong>open</strong></p>')
    expect(sanitizeRichText('stray</strong> text')).toBe('stray text')
  })
})

describe('plainTextToHtml', () => {
  it('turns blank lines into paragraphs and single ones into breaks', () => {
    expect(plainTextToHtml('Эхний мөр\nхоёр дахь\n\nШинэ догол')).toBe(
      '<p>Эхний мөр<br>хоёр дахь</p><p>Шинэ догол</p>',
    )
  })
})

describe('toRichHtml', () => {
  it('converts descriptions saved before the editor existed', () => {
    expect(toRichHtml('Найрлага:\n- Ус\n\nХэрэглээ')).toBe(
      '<p>Найрлага:<br>- Ус</p><p>Хэрэглээ</p>',
    )
  })

  it('passes editor HTML through the allowlist', () => {
    expect(toRichHtml('<p>a</p><script>x</script>')).toBe('<p>a</p>')
  })

  it('treats blank and missing values the same', () => {
    expect(toRichHtml(null)).toBe('')
    expect(toRichHtml('   ')).toBe('')
  })
})

describe('richTextToPlain', () => {
  it('flattens markup to lines', () => {
    expect(richTextToPlain('<p>Тос</p><ul><li>30g</li><li>70g</li></ul>')).toBe(
      'Тос\n30g\n70g',
    )
  })
})

describe('sanitizeRichText block nesting', () => {
  it('lifts a list out of the paragraph the editor wrapped it in', () => {
    expect(sanitizeRichText('<p><ul><li>30g</li></ul></p>')).toBe(
      '<ul><li>30g</li></ul>',
    )
    expect(sanitizeRichText('<p>Хэмжээ</p><p><ol><li>a</li></ol></p>')).toBe(
      '<p>Хэмжээ</p><ol><li>a</li></ol>',
    )
  })

  it('drops paragraphs with nothing in them', () => {
    expect(sanitizeRichText('<p>a</p><p></p><p><br></p><p>b</p>')).toBe(
      '<p>a</p><p>b</p>',
    )
  })
})
