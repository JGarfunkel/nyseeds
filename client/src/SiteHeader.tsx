export default function SiteHeader() {
  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <a href="/ordinizer" className="text-xl font-semibold text-gray-900 hover:text-green-700 transition-colors">
            NYSeeds
          </a>
          <nav className="flex items-center gap-6 text-sm font-medium text-civic-gray-light" aria-label="Main">
            <a href="/ordinizer" className="hover:text-gray-900 transition-colors">Ordinances</a>
            <a href="/projects" className="hover:text-gray-900 transition-colors">Projects</a>
            <a href="/about" className="hover:text-gray-900 transition-colors">About</a>
          </nav>
        </div>
      </div>
    </header>
  );
}
