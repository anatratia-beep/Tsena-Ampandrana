// Fuseau horaire de Madagascar pour les calculs faits dans le cloud (fonction ai-chat).
// L'application calcule les jours (« aujourd'hui », « cette semaine »…) à l'heure de l'appareil, à Madagascar.
// Le serveur cloud est à l'heure UTC : on remplace Date par une version à l'heure de Madagascar (UTC+3, sans heure
// d'été), pour que les mêmes fonctions donnent exactement les mêmes jours que dans l'application.
export const TZ_NAME = 'Indian/Antananarivo';
const OFF = 3 * 3600_000;
const RealDate: DateConstructor = (globalThis as any).__RealDate ?? globalThis.Date;
(globalThis as any).__RealDate = RealDate;
/** « 2026-08-01T12:00:00 » sans fuseau : heure locale (Madagascar), comme dans le navigateur. */
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

class TzDate extends RealDate {
  constructor(...a: any[]) {
    if (a.length === 0) super();
    else if (a.length === 1) {
      const v = a[0];
      if (typeof v === 'string' && LOCAL_RE.test(v.trim())) super(RealDate.parse(v.trim() + '+03:00'));
      else super(v instanceof RealDate ? v.getTime() : v);
    } else super(RealDate.UTC(a[0], a[1], a[2] ?? 1, a[3] ?? 0, a[4] ?? 0, a[5] ?? 0, a[6] ?? 0) - OFF);
  }
  private loc() { return new RealDate(this.getTime() + OFF); }
  private setLoc(f: (d: Date) => void) { const d = this.loc(); f(d); return this.setTime(d.getTime() - OFF); }
  getFullYear() { return this.loc().getUTCFullYear(); }
  getMonth() { return this.loc().getUTCMonth(); }
  getDate() { return this.loc().getUTCDate(); }
  getDay() { return this.loc().getUTCDay(); }
  getHours() { return this.loc().getUTCHours(); }
  getMinutes() { return this.loc().getUTCMinutes(); }
  getSeconds() { return this.loc().getUTCSeconds(); }
  getMilliseconds() { return this.loc().getUTCMilliseconds(); }
  getTimezoneOffset() { return -OFF / 60000; }
  setFullYear(...a: [number, number?, number?]) { return this.setLoc((d) => (d.setUTCFullYear as any)(...a)); }
  setMonth(...a: [number, number?]) { return this.setLoc((d) => (d.setUTCMonth as any)(...a)); }
  setDate(n: number) { return this.setLoc((d) => d.setUTCDate(n)); }
  setHours(...a: [number, number?, number?, number?]) { return this.setLoc((d) => (d.setUTCHours as any)(...a)); }
  setMinutes(...a: [number, number?, number?]) { return this.setLoc((d) => (d.setUTCMinutes as any)(...a)); }
  setSeconds(...a: [number, number?]) { return this.setLoc((d) => (d.setUTCSeconds as any)(...a)); }
  setMilliseconds(n: number) { return this.setLoc((d) => d.setUTCMilliseconds(n)); }
  toLocaleString(l?: any, o?: Intl.DateTimeFormatOptions) { return super.toLocaleString(l, { timeZone: TZ_NAME, ...o }); }
  toLocaleDateString(l?: any, o?: Intl.DateTimeFormatOptions) { return super.toLocaleDateString(l, { timeZone: TZ_NAME, ...o }); }
  toLocaleTimeString(l?: any, o?: Intl.DateTimeFormatOptions) { return super.toLocaleTimeString(l, { timeZone: TZ_NAME, ...o }); }
}
(globalThis as any).Date = TzDate;
