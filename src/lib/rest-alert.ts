let audioContext: AudioContext | null = null

export function primeRestAlert() {
  try {
    audioContext ??= new AudioContext()
    void audioContext.resume()
  } catch { /* audio is optional */ }
}

export function notifyRestComplete(exerciseName: string) {
  navigator.vibrate?.([160, 90, 160])
  try {
    if (audioContext) {
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      oscillator.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.45)
      oscillator.connect(gain).connect(audioContext.destination)
      oscillator.start(); oscillator.stop(audioContext.currentTime + 0.46)
    }
  } catch { /* vibration and visual state remain */ }
  if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    new Notification('Отдых закончен', { body: `Можно продолжать: ${exerciseName}`, icon: `${import.meta.env.BASE_URL}icon.svg` })
  }
}
