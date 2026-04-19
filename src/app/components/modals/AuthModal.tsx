import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Eye, EyeOff, Users, Calendar, Heart, Church } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'login' | 'signup';
  onSuccess?: () => void;
}

export function AuthModal({ isOpen, onClose, defaultMode = 'login', onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>(defaultMode);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    organizationName: '',
    phone: '',
  });
  
  const { login, signup } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    
    setError('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        
        // Validation
        if (!formData.firstName || !formData.lastName) {
          setError('Please enter your first and last name');
          setLoading(false);
          return;
        }
        if (formData.password !== formData.confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }
        if (formData.password.length < 8) {
          setError('Password must be at least 8 characters');
          setLoading(false);
          return;
        }

        const signupData = {
          email: formData.email,
          password: formData.password,
          firstName: formData.firstName,
          lastName: formData.lastName,
          organizationName: formData.organizationName || 'My Organization',
        };
        
        await signup(signupData);
        
        toast.success('Account created successfully!');
        
        if (onSuccess) {
          onSuccess();
        }
        onClose();
      } else {
        
        const result = await login(formData.email, formData.password);
        
        
        toast.success('Welcome back!');
        onSuccess?.();
        onClose();
        
      }
    } catch (err: any) {
      
      setError(err.message || 'An error occurred. Please try again.');
      toast.error(err.message || 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'signup' : 'login');
    setError('');
    setFormData({
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
      organizationName: '',
      phone: '',
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Modal */}
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="pointer-events-auto relative w-full max-w-5xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
                <div className="grid md:grid-cols-2 min-h-[600px]">
                  {/* Left Panel - Branding */}
                  <div className="relative bg-gradient-to-br from-blue-400 via-blue-400 to-blue-500 p-12 flex flex-col justify-center items-center text-white overflow-hidden">
                    {/* Decorative Background Elements */}
                    <div className="absolute inset-0 opacity-10">
                      <div className="absolute top-10 left-10 w-64 h-64 bg-white rounded-full blur-3xl" />
                      <div className="absolute bottom-10 right-10 w-96 h-96 bg-blue-600 rounded-full blur-3xl" />
                    </div>

                    <div className="relative z-10 text-center">
                      {/* Logo */}
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                        className="mb-8 inline-flex items-center justify-center w-24 h-24 bg-white/95 backdrop-blur-lg rounded-2xl p-2 shadow-lg"
                      >
                        <img
                          src="/sheepmug-logo.png"
                          alt=""
                          className="w-full h-full object-contain"
                        />
                      </motion.div>

                      {/* Title */}
                      <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="text-4xl font-bold mb-2"
                      >
                        SheepMug
                      </motion.h2>
                      <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.35 }}
                        className="text-xl font-medium text-white/95 mb-6"
                      >
                        Discipleship Made Easy
                      </motion.p>

                      <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        className="text-lg text-white/90 mb-12 max-w-md mx-auto leading-relaxed"
                      >
                        A comprehensive platform empowering church leaders to manage their communities with excellence
                      </motion.p>

                      {/* Feature Icons */}
                      <div className="flex justify-center gap-4 mb-8">
                        {[
                          { icon: Users, delay: 0.5 },
                          { icon: Calendar, delay: 0.6 },
                          { icon: Heart, delay: 0.7 },
                          { icon: Church, delay: 0.8 },
                        ].map((item, index) => (
                          <motion.div
                            key={index}
                            initial={{ opacity: 0, scale: 0, rotate: -180 }}
                            animate={{ opacity: 1, scale: 1, rotate: 0 }}
                            transition={{
                              delay: item.delay,
                              type: 'spring',
                              stiffness: 200,
                              damping: 15,
                            }}
                            className="w-16 h-16 bg-white/20 backdrop-blur-lg rounded-full flex items-center justify-center"
                          >
                            <item.icon className="w-8 h-8 text-white" />
                          </motion.div>
                        ))}
                      </div>

                      {/* Pagination Dots */}
                      <div className="flex justify-center gap-2">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            initial={{ width: 8 }}
                            animate={{ width: i === 0 ? 32 : 8 }}
                            className="h-2 bg-white/40 rounded-full"
                            transition={{ delay: 0.9 + i * 0.1 }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right Panel - Form */}
                  <div className="p-12 flex flex-col relative">
                    {/* Close Button */}
                    <button
                      onClick={onClose}
                      className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
                    >
                      <X className="w-5 h-5 text-gray-500" />
                    </button>

                    <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
                      {/* Header */}
                      <motion.div
                        key={mode}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3 }}
                        className="mb-8"
                      >
                        <h3 className="text-3xl font-bold text-gray-900 mb-2">
                          {mode === 'login' ? 'Welcome Back' : 'Get Started'}
                        </h3>
                        <p className="text-gray-600">
                          {mode === 'login' ? 'Don\'t have an account?' : 'Already have an account?'}{' '}
                          <button
                            onClick={toggleMode}
                            className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                          >
                            {mode === 'login' ? 'Sign Up' : 'Sign In'}
                          </button>
                        </p>
                      </motion.div>

                      {/* Form */}
                      <form onSubmit={handleSubmit} className="space-y-5">
                        <AnimatePresence mode="wait">
                          {mode === 'signup' && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.3 }}
                              className="grid grid-cols-2 gap-4"
                            >
                              <div className="space-y-2">
                                <Label htmlFor="firstName" className="text-gray-700">
                                  First Name
                                </Label>
                                <Input
                                  id="firstName"
                                  type="text"
                                  placeholder="John"
                                  value={formData.firstName}
                                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                                  className="h-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                  required={mode === 'signup'}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="lastName" className="text-gray-700">
                                  Last Name
                                </Label>
                                <Input
                                  id="lastName"
                                  type="text"
                                  placeholder="Doe"
                                  value={formData.lastName}
                                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                                  className="h-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                  required={mode === 'signup'}
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="space-y-2">
                          <Label htmlFor="email" className="text-gray-700">
                            Email
                          </Label>
                          <Input
                            id="email"
                            type="email"
                            placeholder="john.doe@example.com"
                            value={formData.email}
                            onChange={(e) => handleInputChange('email', e.target.value)}
                            className="h-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="password" className="text-gray-700">
                            Password
                          </Label>
                          <div className="relative">
                            <Input
                              id="password"
                              type={showPassword ? 'text' : 'password'}
                              placeholder="••••••••"
                              value={formData.password}
                              onChange={(e) => handleInputChange('password', e.target.value)}
                              className="h-12 pr-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                              required
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                            >
                              {showPassword ? (
                                <EyeOff className="w-5 h-5" />
                              ) : (
                                <Eye className="w-5 h-5" />
                              )}
                            </button>
                          </div>
                        </div>

                        <AnimatePresence mode="wait">
                          {mode === 'signup' && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.3 }}
                              className="space-y-2"
                            >
                              <Label htmlFor="confirmPassword" className="text-gray-700">
                                Confirm Password
                              </Label>
                              <Input
                                id="confirmPassword"
                                type="password"
                                placeholder="••••••••"
                                value={formData.confirmPassword}
                                onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                                className="h-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                required={mode === 'signup'}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <AnimatePresence mode="wait">
                          {mode === 'signup' && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.3 }}
                              className="space-y-2"
                            >
                              <Label htmlFor="organizationName" className="text-gray-700">
                                Organization Name
                              </Label>
                              <Input
                                id="organizationName"
                                type="text"
                                placeholder="My Church"
                                value={formData.organizationName}
                                onChange={(e) => handleInputChange('organizationName', e.target.value)}
                                className="h-12 border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                                required={mode === 'signup'}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {error && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600"
                          >
                            {error}
                          </motion.div>
                        )}

                        {mode === 'login' && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
                            >
                              Forgot password?
                            </button>
                          </div>
                        )}

                        <Button
                          type="submit"
                          disabled={loading}
                          className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                        >
                          {loading ? (
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              {mode === 'login' ? 'Signing In...' : 'Creating Account...'}
                            </div>
                          ) : (
                            mode === 'login' ? 'Sign In' : 'Create Account'
                          )}
                        </Button>

                        {mode === 'login' && (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full mt-4 h-12 border-gray-300 text-gray-700 hover:bg-gray-50 font-medium rounded-lg transition-colors"
                            onClick={async () => {
                              setLoading(true);
                              try {
                                toast.info('Attempting demo login...');
                                await login('admin@churchhub.com', 'password123');
                                onClose();
                              } catch (err) {
                                toast.error('Demo login failed. Please use the standard form.');
                              } finally {
                                setLoading(false);
                              }
                            }}
                          >
                            Try Demo Account
                          </Button>
                        )}
                      </form>

                      {mode === 'signup' && (
                        <motion.p
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.4 }}
                          className="text-xs text-gray-500 text-center mt-6"
                        >
                          By creating an account, you agree to our{' '}
                          <a href="#" className="text-blue-600 hover:underline">
                            Terms of Service
                          </a>{' '}
                          and{' '}
                          <a href="#" className="text-blue-600 hover:underline">
                            Privacy Policy
                          </a>
                        </motion.p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}