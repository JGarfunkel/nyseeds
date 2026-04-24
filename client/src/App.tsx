/**
 * Sample Site - Minimal wrapper demonstrating how to integrate Ordinizer
 * 
 * This is a sample website that shows how to host Ordinizer as one component
 * among potentially multiple applications. Other applications can be added here.
 */
import { Switch, Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster, TooltipProvider } from "@ordinizer/client/ui";
import { OrdinizerApp } from "@ordinizer/app/App";
import { queryClient } from "./lib/queryClient";
import AboutPage from "./AboutPage";

function Router() {
  // Check if path starts with /ordinizer and render accordingly
  const pathname = window.location.pathname;
  
  if (pathname.startsWith('/ordinizer')) {
    return <OrdinizerApp basePath="/ordinizer" />;
  }
  
  // Redirect root to /ordinizer
  if (pathname === '' || pathname === '/') {
    window.location.href = '/ordinizer';
    return null;
  }
  
  return (
    <Switch>
      {/* Root - redirect handled above */}
      
      {/* About route */}
      <Route path="/about" component={AboutPage} />
      
      {/* 404 fallback */}
      <Route>
        {() => (
          <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
              <p className="text-xl text-gray-600 mb-8">Page not found</p>
              <a
                href="/"
                className="text-green-600 hover:text-green-700 underline"
              >
                Return home
              </a>
            </div>
          </div>
        )}
      </Route>
    </Switch>
  );
}

function Footer() {
  return (
      <footer className="bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center space-x-3 mb-4 md:mb-0">
              <span className="text-sm text-civic-gray-light">NYSeeds & Ordinizer © 2026 Civilly Engaged. Making municipal law accessible.</span>
            </div>
            <div className="flex items-center space-x-6 text-sm text-civic-gray-light">
              <a href="/about" className="hover:text-gray-900 transition-colors">About</a>

              <a href="https://github.com/JGarfunkel/ordinizer" 
              className="hover:text-gray-900 transition-colors">Github: Ordinizer</a>
              <a href="mailto:civillyengaged@gmail.com" className="hover:text-gray-900 transition-colors">Contact</a>
            </div>
          </div>
        </div>
      </footer>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <div className="flex flex-col min-h-screen">
          <div className="flex-1">
            <Router />
          </div>
          <Footer />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
