export function LoadingScreen({ label = 'Загружаем Достигатор' }: { label?: string }) {
  return (
    <div className="loading-screen" role="status">
      <div className="brand-mark small" aria-hidden="true">Д</div>
      <span>{label}</span>
    </div>
  )
}
