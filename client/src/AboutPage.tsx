import React from "react";
import faq from "./faq.json";

export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-3xl font-bold mb-4">About NY Seeds</h1>
      <p className="mb-4">
        NY Seeds is an environmental statute analysis application powered by the 
        Ordinizer library. It helps users analyze and compare municipal statutes 
        across New York municipalities with AI-powered plain-language summaries.
      </p>
      <p>
        This project is open source and maintained by the NY Seeds team. 
        For more information, visit our GitHub repository or contact us.
      </p>
      <h2 className="text-2xl font-semibold mb-4 mt-8">Frequently Asked Questions</h2>
      <div className="space-y-6">
        {faq.map((item, idx) => (
          <div key={idx}>
            <div className="font-medium text-lg mb-1">{item.question}</div>
            <div className="text-gray-700">{item.answer}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
