"use client";
import { useState } from 'react';

export default function CheckoutPage() {
  const [formData, setFormData] = useState({
    email: '',
    cardNumber: '',
    expiry: '',
    cvv: '',
    amount: ''
  });
  
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [emailWarning, setEmailWarning] = useState("");
  const [emailValidating, setEmailValidating] = useState(false);
  const [emailValid, setEmailValid] = useState<boolean | null>(null);
  const [cardValidating, setCardValidating] = useState(false);
  const [cardValid, setCardValid] = useState<boolean | null>(null);
  const [cardMessage, setCardMessage] = useState("");

  // Format card number with spaces every 4 digits
  const formatCardNumber = (value: string) => {
    // Remove all non-digits
    const digitsOnly = value.replace(/\D/g, '');
    // Add space every 4 digits
    const formatted = digitsOnly.match(/.{1,4}/g)?.join(' ') || digitsOnly;
    return formatted;
  };

  // Format expiry date as MM/YY
  const formatExpiry = (value: string) => {
    // Remove all non-digits
    const digitsOnly = value.replace(/\D/g, '');
    // Add slash after 2 digits
    if (digitsOnly.length >= 2) {
      return digitsOnly.slice(0, 2) + '/' + digitsOnly.slice(2, 4);
    }
    return digitsOnly;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    
    // Special handling for card number formatting
    if (name === 'cardNumber') {
      const formatted = formatCardNumber(value);
      setFormData(prev => ({ ...prev, cardNumber: formatted }));
      setCardValid(null);
      setCardMessage("");
      return;
    }
    
    // Special handling for expiry formatting
    if (name === 'expiry') {
      const formatted = formatExpiry(value);
      setFormData(prev => ({ ...prev, expiry: formatted }));
      return;
    }
    
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Reset validation states when user types
    if (name === 'email') {
      setEmailValid(null);
      setEmailWarning("");
    }
  };

  // XHR/Async email validation on blur
  const handleEmailBlur = async () => {
    if (!formData.email) return;
    
    setEmailValidating(true);
    setEmailWarning("");
    
    try {
      const res = await fetch('http://localhost:8080/api/validate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email }),
      });

      if (res.status === 500) {
        // SOFT FAIL: Backend email validation service is down
        console.warn('Email validation service unavailable (500), soft-failing');
        setEmailWarning('⚠️ Email validation service temporarily unavailable. You can still proceed.');
        setEmailValid(true); // Soft fail - allow to pass
      } else {
        const data = await res.json();
        setEmailValid(data.valid);
        if (!data.valid) {
          setEmailWarning('❌ Invalid email format');
        }
      }
    } catch (err) {
      // Network error - also soft fail
      console.warn('Email validation network error, soft-failing');
      setEmailWarning('⚠️ Could not validate email. You can still proceed.');
      setEmailValid(true); // Soft fail
    } finally {
      setEmailValidating(false);
    }
  };

  // XHR/Async card validation on blur
  const handleCardBlur = async () => {
    if (!formData.cardNumber) return;
    
    setCardValidating(true);
    setCardMessage("");
    
    try {
      const res = await fetch('http://localhost:8080/api/validate-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardNumber: formData.cardNumber }),
      });

      const data = await res.json();
      setCardValid(data.valid);
      
      if (data.valid) {
        setCardMessage('✅ Valid card number (Luhn check passed)');
      } else {
        setCardMessage('❌ Invalid card number (Luhn check failed)');
      }
    } catch (err) {
      console.error('Card validation error:', err);
      setCardMessage('⚠️ Could not validate card number');
      setCardValid(null);
    } finally {
      setCardValidating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    // Check if card validation failed
    if (cardValid === false) {
      setMessage("❌ Please enter a valid card number");
      setLoading(false);
      return;
    }

    // Process payment
    try {
      const res = await fetch('http://localhost:8080/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardNumber: formData.cardNumber,
          expiry: formData.expiry,
          cvv: formData.cvv,
          amount: parseFloat(formData.amount)
        }),
      });

      const data = await res.json();
      
      if (res.ok) {
        setMessage(`✅ ${data.message}`);
      } else {
        setMessage(`❌ Payment failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      setMessage("❌ Failed to connect to backend server");
    } finally {
      setLoading(false);
    }
  };

  const checkHealth = async () => {
    try {
      const res = await fetch('http://localhost:8080/api/health');
      const data = await res.json();
      setMessage(`🟢 Backend Status: ${data.status} - ${data.message}`);
    } catch (err) {
      setMessage("🔴 Backend is not responding");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-4">
      <div className="backdrop-blur-sm bg-white/95 rounded-2xl shadow-2xl w-full max-w-md p-8 transform transition-all hover:scale-[1.01]">
        <div className="text-center mb-8">
          <div className="inline-block p-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <h2 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Secure Checkout
          </h2>
          <p className="text-gray-600 mt-2 text-sm">Complete your payment securely</p>
        </div>
        
        <button
          onClick={checkHealth}
          className="w-full mb-6 p-3 bg-gradient-to-r from-gray-100 to-gray-50 hover:from-gray-200 hover:to-gray-100 text-gray-700 rounded-xl text-sm font-medium transition-all duration-300 border border-gray-200 hover:border-gray-300 hover:shadow-md"
        >
          🔌 Check Backend Status
        </button>

        {message && (
          <div className={`p-4 rounded-xl mb-6 text-sm font-medium shadow-lg transform transition-all duration-300 ${
            message.includes('✅') || message.includes('🟢') 
              ? 'bg-gradient-to-r from-green-50 to-emerald-50 text-green-700 border-l-4 border-green-500' 
              : message.includes('❌') || message.includes('🔴')
              ? 'bg-gradient-to-r from-red-50 to-rose-50 text-red-700 border-l-4 border-red-500'
              : 'bg-gradient-to-r from-blue-50 to-cyan-50 text-blue-700 border-l-4 border-blue-500'
          }`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="group">
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center">
              <svg className="w-4 h-4 mr-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Email Address
              {emailValidating && (
                <span className="ml-2 text-xs text-blue-600 flex items-center">
                  <svg className="animate-spin h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Validating...
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                onBlur={handleEmailBlur}
                placeholder="you@example.com"
                className={`w-full p-4 pr-12 border-2 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-500 transition-all duration-300 bg-white hover:border-gray-300 placeholder-gray-400 ${
                  emailValid === true ? 'border-green-400' : emailValid === false ? 'border-red-400' : 'border-gray-200'
                }`}
                required
              />
              {emailValid === true && (
                <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            {emailWarning && (
              <p className="text-xs mt-1.5 ml-1 font-medium text-yellow-600">
                {emailWarning}
              </p>
            )}
          </div>

          <div className="group">
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center">
              <svg className="w-4 h-4 mr-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Card Number
              {cardValidating && (
                <span className="ml-2 text-xs text-blue-600 flex items-center">
                  <svg className="animate-spin h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Validating...
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type="text"
                name="cardNumber"
                value={formData.cardNumber}
                onChange={handleInputChange}
                onBlur={handleCardBlur}
                placeholder="1234 5678 9012 3456"
                maxLength={19}
                className={`w-full p-4 pr-12 border-2 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-500 transition-all duration-300 bg-white hover:border-gray-300 placeholder-gray-400 font-mono text-lg tracking-wide ${
                  cardValid === true ? 'border-green-400' : cardValid === false ? 'border-red-400' : 'border-gray-200'
                }`}
                required
              />
              {cardValid === true && (
                <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
              {cardValid === false && (
                <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            {cardMessage && (
              <p className={`text-xs mt-1.5 ml-1 font-medium ${
                cardMessage.includes('✅') ? 'text-green-600' : 'text-red-600'
              }`}>
                {cardMessage}
              </p>
            )}
          </div>

          <div className="flex gap-4">
            <div className="flex-1 group">
              <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center">
                <svg className="w-4 h-4 mr-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Expiry
              </label>
              <input
                type="text"
                name="expiry"
                value={formData.expiry}
                onChange={handleInputChange}
                placeholder="MM/YY"
                maxLength={5}
                className="w-full p-4 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-500 transition-all duration-300 bg-white hover:border-gray-300 placeholder-gray-400 font-mono"
                required
              />
            </div>
            <div className="flex-1 group">
              <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center">
                <svg className="w-4 h-4 mr-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                CVV
              </label>
              <input
                type="password"
                name="cvv"
                value={formData.cvv}
                onChange={handleInputChange}
                placeholder="123"
                maxLength={4}
                className="w-full p-4 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-500 transition-all duration-300 bg-white hover:border-gray-300 placeholder-gray-400 font-mono text-center"
                required
              />
            </div>
          </div>

          <div className="group">
            <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center">
              <svg className="w-4 h-4 mr-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Amount (USD)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg font-semibold">$</span>
              <input
                type="number"
                name="amount"
                value={formData.amount}
                onChange={handleInputChange}
                placeholder="0.00"
                step="0.01"
                min="0.01"
                className="w-full p-4 pl-10 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-500 transition-all duration-300 bg-white hover:border-gray-300 placeholder-gray-400 text-lg font-semibold"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full p-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-xl font-bold text-lg transition-all duration-300 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center"
          >
            {loading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing Payment...
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {formData.amount ? `Pay $${formData.amount}` : 'Complete Payment'}
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500 flex items-center justify-center">
            <svg className="w-4 h-4 mr-1.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
            </svg>
            Secured with 256-bit SSL encryption
          </p>
        </div>
      </div>
    </div>
  );
}
