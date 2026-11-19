// タッチの見回しの取り出し（11-19 23:27 の要望: エイム・カメラの緻密さ・正確さ・なめらかさ）
// 指の位置を時刻つきで記録し、こまごとに「今より D だけ前」の指の位置を前後の記録から直線で求め、前のこまとの差を出す。
//  D は指の位置が届く間隔より短く、こまの直前に届く端末では数 ms。遅れは D だけで、指を止めるとぴたりと止まる
//  （前のやり方: 届いた量を 20〜50ms の「ならし」で少しずつ足していたので、遅れが大きく、止めた後も尾を引いていた）
export class LookResampler {
  constructor() { this.pts = []; this.cx = 0; this.cy = 0; this.ox = 0; this.oy = 0; this.iv = 16.7; this.age = 16.7; }
  // 指が動いた（dx, dy は画面の上の画素。t は出来事の時刻 ms）
  add(dx, dy, t) {
    const P = this.pts, last = P[P.length - 1];
    if (last && t < last.t) t = last.t;
    if (!last || t - last.t > 50) {
      // しばらく止まっていた後の動き出し: 1つ前の間隔ぶん前に「動く前の位置」を置く（止まっていた時間に動きを広げない）
      P.push({ t: t - Math.min(this.iv, 17), x: this.cx, y: this.cy });
    } else if (t > last.t) {
      this.iv += ((t - last.t) - this.iv) * 0.2;
    }
    this.cx += dx; this.cy += dy;
    if (last && t === last.t && P.length) { const q = P[P.length - 1]; q.x = this.cx; q.y = this.cy; }
    else P.push({ t, x: this.cx, y: this.cy });
    if (P.length > 32) P.splice(0, P.length - 32);
  }
  // こまの時刻 now（ms）で、前のこまからの動きを取り出す
  take(now) {
    const P = this.pts;
    if (!P.length) return [0, 0];
    const last = P[P.length - 1];
    // D: 届いた一番新しい位置の「こまの時の古さ」の山（ゆっくり下がる）+ 1ms。届く間隔より長くはしない。
    //  こまの直前に届く端末（iPhone の Safari）では数 ms、こまとずれて届く時は届く間隔くらいになる
    const a = now - last.t;
    if (a < this.iv * 2.5) this.age = Math.max(a, this.age - 0.25);
    const D = Math.max(3, Math.min(22, this.iv, this.age + 1));
    const T = now - D;
    let x, y;
    if (T >= last.t) { x = last.x; y = last.y; }
    else if (T <= P[0].t) { x = P[0].x; y = P[0].y; }
    else {
      let i = P.length - 1; while (i > 0 && P[i - 1].t > T) i--;
      const a = P[i - 1], b = P[i], f = (T - a.t) / Math.max(1e-6, b.t - a.t);
      x = a.x + (b.x - a.x) * f; y = a.y + (b.y - a.y) * f;
    }
    // 取り出したのより前の古い記録は捨てる（直線で求めるのに1つ前は残す）
    while (P.length > 2 && P[1].t <= T) P.shift();
    const dx = x - this.ox, dy = y - this.oy;
    this.ox = x; this.oy = y;
    return [dx, dy];
  }
  // 残り（まだ取り出していない動き）
  pending() { return [this.cx - this.ox, this.cy - this.oy]; }
}
