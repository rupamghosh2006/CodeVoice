/**
 * Patch for @convo-lang/tui
 *
 * Fixes:
 * 1. Comma-splitting bug in renderBufferDiffAnsi:
 *    Upstream library interpolates buffer array as `${output}` which stringifies
 *    to `output.toString()` (joining array items with commas `,`).
 *    Fixed by returning `output.join('')`.
 *
 * 2. Background color inversion in clearBuffer:
 *    Upstream library sets `c.b = f;` instead of `c.b = b;`, causing cleared
 *    cells to adopt the foreground color as their background color.
 *    Fixed by setting `c.b = b;`.
 *
 * 3. Modal screen transitions:
 *    Ensure full repaint (`this.forceFullRender = true`) when switching screens
 *    so dirty buffers from previous screens do not linger.
 */

export function patchConvoTuiCtrl(Ctrl: any): void {
  if (!Ctrl || Ctrl.__codeVoicePatched) return;
  Ctrl.__codeVoicePatched = true;

  // 1. Fix comma-joining bug in renderBufferDiffAnsi
  Ctrl.prototype.renderBufferDiffAnsi = function (front: any, back: any, bounds: any) {
    try {
      const output = this.tmpBuffer;
      let activeF: any;
      let activeB: any;
      const yl = Math.min(bounds.y + bounds.height, back.length);
      for (let y = bounds.y; y < yl; y++) {
        const backRow = back[y];
        const frontRow = front[y] ?? [];
        const xl = Math.min(bounds.x + bounds.width, backRow.length);
        let x = bounds.x;
        while (x < xl) {
          if (this.isSameRenderChar(frontRow[x], backRow[x])) {
            x++;
            continue;
          }
          output.push(this.getCursorPositionAnsi(x, y));
          while (x < backRow.length && !this.isSameRenderChar(frontRow[x], backRow[x])) {
            const char = backRow[x];
            if (char.f !== activeF) {
              output.push(this.getFgAnsi(char.f));
              activeF = char.f;
            }
            if (char.b !== activeB) {
              output.push(this.getBgAnsi(char.b));
              activeB = char.b;
            }
            output.push(char.c);
            x++;
          }
        }
      }
      return output.length ? `\x1b[0m${output.join('')}\x1b[0m` : '';
    } finally {
      this.clearTmpBuffer();
    }
  };

  // 2. Fix c.b = f typo in clearBuffer
  Ctrl.prototype.clearBuffer = function (buffer: any) {
    const f = this.resolveColor(this.theme.foreground);
    const b = this.resolveColor(this.theme.background);
    for (let y = 0; y < this.bufferState.height; y++) {
      let row = buffer[y];
      if (!row) {
        row = [];
        buffer[y] = row;
      }
      for (let x = 0; x < this.bufferState.width; x++) {
        let c = row[x];
        if (!c) {
          c = this.createChar();
          row[x] = c;
        } else {
          c.c = ' ';
          c.f = f;
          c.b = b;
          c.i = '';
        }
      }
    }
  };

  // 3. Clean full repaint on screen switch
  const origActivateScreen = Ctrl.prototype.activateScreen;
  Ctrl.prototype.activateScreen = function (id: string) {
    this.forceFullRender = true;
    return origActivateScreen.call(this, id);
  };
}
