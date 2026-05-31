import { create } from 'zustand';
import type { User, AuthState } from '../types';

interface AuthActions {
  login: (token: string, user: User) => void;
  logout: () => void;
  setToken: (token: string) => void;
  setUser: (user: User) => void;
  updateUser: (updates: Partial<User>) => void;
  clearAuth: () => void;
  loadFromStorage: () => void;
}

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

const loadFromLocalStorage = (): { token: string | null; user: User | null } => {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const userStr = localStorage.getItem(USER_KEY);
    const user = userStr ? (JSON.parse(userStr) as User) : null;
    return { token, user };
  } catch {
    return { token: null, user: null };
  }
};

const saveToLocalStorage = (token: string, user: User) => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    console.error('Failed to save auth data to localStorage');
  }
};

const clearLocalStorage = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    console.error('Failed to clear auth data from localStorage');
  }
};

export const useAuthStore = create<AuthState & AuthActions>((set, get) => {
  const initial = loadFromLocalStorage();

  return {
    user: initial.user,
    token: initial.token,
    isAuthenticated: !!initial.token && !!initial.user,

    login: (token, user) => {
      saveToLocalStorage(token, user);
      set({
        token,
        user,
        isAuthenticated: true,
      });
    },

    logout: () => {
      clearLocalStorage();
      set({
        token: null,
        user: null,
        isAuthenticated: false,
      });
    },

    setToken: (token) => {
      const { user } = get();
      if (user) {
        saveToLocalStorage(token, user);
      }
      set({ token });
    },

    setUser: (user) => {
      const { token } = get();
      if (token) {
        saveToLocalStorage(token, user);
      }
      set({ user });
    },

    updateUser: (updates) =>
      set((state) => {
        if (!state.user) return {};
        const updatedUser = { ...state.user, ...updates };
        const { token } = get();
        if (token) {
          saveToLocalStorage(token, updatedUser);
        }
        return { user: updatedUser };
      }),

    clearAuth: () => {
      clearLocalStorage();
      set({
        token: null,
        user: null,
        isAuthenticated: false,
      });
    },

    loadFromStorage: () => {
      const { token, user } = loadFromLocalStorage();
      set({
        token,
        user,
        isAuthenticated: !!token && !!user,
      });
    },
  };
});
