/**
 * Swaps the browser's native validation bubble ("Please fill out this
 * field") for Mongolian text. The browser picks that string from its own UI
 * language, not the page's `lang` attribute, so there's no way to localize it
 * short of intercepting the `invalid` event ourselves.
 *
 * Wire both handlers onto the <form> — `onInvalidCapture` (the event doesn't
 * bubble, so it has to be caught on the way down) sets the message,
 * `onInput` clears it so the field re-validates as the user types. Because
 * both are attached to the form rather than each field, `event.currentTarget`
 * is the form itself; the field that actually fired is `event.target`.
 */
type Validatable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

function isValidatable(node: EventTarget | null): node is Validatable {
  return (
    node instanceof HTMLInputElement ||
    node instanceof HTMLTextAreaElement ||
    node instanceof HTMLSelectElement
  )
}

export function localizeValidity(event: React.FormEvent<HTMLFormElement>) {
  const target = event.target
  if (!isValidatable(target)) return
  const validity = target.validity

  if (validity.valueMissing) {
    target.setCustomValidity('Энэ талбарыг бөглөнө үү')
  } else if (validity.typeMismatch) {
    target.setCustomValidity('Зөв утга оруулна уу')
  } else if (validity.patternMismatch || validity.tooShort || validity.tooLong) {
    target.setCustomValidity('Оруулсан утга буруу байна')
  } else if (!validity.valid) {
    target.setCustomValidity('Оруулсан утга буруу байна')
  }
}

export function clearValidity(event: React.FormEvent<HTMLFormElement>) {
  const target = event.target
  if (!isValidatable(target)) return
  target.setCustomValidity('')
}
