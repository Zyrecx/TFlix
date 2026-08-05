import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
globalThis.document = { body: {}, documentElement: {}, activeElement: null };

const {
  activateFocusedElement,
  getActivationTarget,
  isEnterKey
} = await import('../mods/remote-activation.js');

function element(tagName, options = {}) {
  return {
    tagName: tagName.toUpperCase(),
    disabled: Boolean(options.disabled),
    isContentEditable: Boolean(options.isContentEditable),
    clicks: 0,
    getAttribute(name) {
      if (name === 'role') return options.role || null;
      if (name === 'aria-disabled') return options.ariaDisabled || null;
      return null;
    },
    querySelector() { return options.child || null; },
    click() { this.clicks += 1; }
  };
}

function keyEvent(overrides = {}) {
  return {
    key: 'Enter',
    keyCode: 13,
    which: 13,
    repeat: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
    ...overrides
  };
}

test('recognizes Samsung Enter by keyCode when key is absent', () => {
  assert.equal(isEnterKey(keyEvent({ key: 'Unidentified', keyCode: 13 })), true);
});

test('activates the focused native movie link exactly once', () => {
  const link = element('a');
  document.activeElement = link;
  const event = keyEvent();

  assert.equal(activateFocusedElement(event), true);
  assert.equal(link.clicks, 1);
  assert.equal(event.prevented, true);
});

test('activates a nested movie link from a tabindex card wrapper', () => {
  const link = element('a');
  const card = element('div', { child: link });
  document.activeElement = card;

  assert.equal(getActivationTarget(card), link);
  assert.equal(activateFocusedElement(keyEvent()), true);
  assert.equal(link.clicks, 1);
});

test('does not activate while typing, during playback, or on key repeat', () => {
  const input = element('input');
  document.activeElement = input;
  assert.equal(activateFocusedElement(keyEvent()), false);

  const link = element('a');
  document.activeElement = link;
  window.__tflixPlayerActive = () => true;
  assert.equal(activateFocusedElement(keyEvent()), false);
  window.__tflixPlayerActive = () => false;
  assert.equal(activateFocusedElement(keyEvent({ repeat: true })), false);
  assert.equal(link.clicks, 0);
});
