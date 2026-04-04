import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  token: string | null;
}

interface SignupData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  organizationName?: string;
  phone?: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Mock user for bypass
const MOCK_USER: User = {
  id: 'mock-user-123',
  email: 'admin@churchhub.com',
  first_name: 'Admin',
  last_name: 'User',
  organization_id: 'mock-org-123',
  is_super_admin: true,
  organization: {
    id: 'mock-org-123',
    name: 'Demo Church',
    slug: 'demo-church',
  },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (storedToken && storedUser) {
      try {
        setUser(JSON.parse(storedUser));
        setToken(storedToken);
      } catch (e) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
      }
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    try {
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Login failed');

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
      setToken(data.token);
    } catch (error: any) {
      throw error;
    }
  };

  const signup = async (signupData: SignupData) => {
    try {
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout for signup

      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: signupData.email,
          password: signupData.password,
          organizationName: signupData.organizationName || `${signupData.firstName}'s Organization`,
          fullName: `${signupData.firstName} ${signupData.lastName}`
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        const errorMessage = data.details ? `${data.error}: ${data.details}` : (data.error || 'Signup failed');
        throw new Error(errorMessage);
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
      setToken(data.token);
    } catch (error: any) {
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    setToken(null);
    window.location.href = '/';
  };

  const value = {
    user,
    loading,
    login,
    signup,
    logout,
    isAuthenticated: !!user,
    token,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}