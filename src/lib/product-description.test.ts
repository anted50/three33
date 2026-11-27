import { describe, expect, it } from 'vitest'
import { toDescriptionHtml } from './product-description'

describe('toDescriptionHtml', () => {
  it('turns a bold-only paragraph into a heading', () => {
    expect(
      toDescriptionHtml(
        '<p>Intro</p><p><strong>IDEAL FOR&nbsp;</strong><strong></strong></p><p>Бүх үсэнд</p>',
      ),
    ).toBe('<p>Intro</p><h3>IDEAL FOR</h3><p>Бүх үсэнд</p>')
  })

  it('trims the spacing and colon off a label, whatever its spelling', () => {
    for (const [label, text] of [
      ['HOW TO USE&nbsp;', 'HOW TO USE'],
      ['How to use :&nbsp;', 'How to use'],
      ['How to use:', 'How to use'],
    ]) {
      expect(
        toDescriptionHtml(`<p>a</p><p>&nbsp;<strong>${label}</strong></p><p>b</p>`),
      ).toBe(`<p>a</p><h3>${text}</h3><p>b</p>`)
    }
  })

  it('splits a paragraph a label is run into', () => {
    expect(
      toDescriptionHtml('<p><strong>IDEAL FOR :&nbsp;</strong>Богино үсэнд.</p>'),
    ).toBe('<h3>IDEAL FOR</h3><p>Богино үсэнд.</p>')
    expect(
      toDescriptionHtml(
        '<p>Volume.<br><br><strong>How to use :&nbsp;</strong><br></p><p>Цацна.</p>',
      ),
    ).toBe('<p>Volume.</p><h3>How to use</h3><p>Цацна.</p>')
  })

  it('lifts a label that sits between blocks', () => {
    expect(
      toDescriptionHtml('<h3>FINISH</h3><br><strong>How to use :&nbsp;</strong><br><p>Цацна.</p>'),
    ).toBe('<h3>FINISH</h3><h3>How to use</h3><p>Цацна.</p>')
  })

  it('leaves bold words inside text alone', () => {
    const html = '<p><strong>Matte Pomade</strong> нь <strong>Үсний төрөл:</strong> бүх</p>'
    expect(toDescriptionHtml(html)).toBe(html)
  })

  // Negative space: a label already in a heading or in a list item stays
  // where it is, so no <h3> lands inside an <h3> and no list is split.
  it('leaves a label inside a heading or a list item alone', () => {
    const inHeading = '<h3><strong>How to use</strong></h3><p>Цацна.</p>'
    expect(toDescriptionHtml(inHeading)).toBe(inHeading)
    const inList = '<ul><li><strong>Ideal for:</strong> богино үс</li></ul>'
    expect(toDescriptionHtml(inList)).toBe(inList)
  })

  it('drops paragraphs that hold only spacing', () => {
    expect(
      toDescriptionHtml('<p>a</p><p>&nbsp;</p><p><strong>&nbsp;</strong></p>'),
    ).toBe('<p>a</p>')
  })

  it('handles empty and plain-text descriptions', () => {
    expect(toDescriptionHtml(null)).toBe('')
    expect(toDescriptionHtml('Нэг\n\nХоёр')).toBe('<p>Нэг</p><p>Хоёр</p>')
  })
})
