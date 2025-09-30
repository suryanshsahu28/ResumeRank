'use client';

import {useState, useEffect, useCallback} from 'react';
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  User,
} from 'firebase/auth';
import {app} from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';


export interface AuthContextType {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const auth = getAuth(app);

export function useAuth(): AuthContextType {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const signInWithGoogle = useCallback(async () => {
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithRedirect(auth, provider);
      // The redirect will navigate the user away. 
      // The result is handled by onAuthStateChanged or getRedirectResult when they return.
    } catch (error) {
      console.error('Error starting sign in with redirect:', error);
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
      // The onAuthStateChanged listener will handle setting the user to null.
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }, []);
  
  const handleUser = useCallback(async (user: User | null) => {
    if (user) {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        // User is new, create a document for them
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: new Date().toISOString(),
          sharesReceived: [], // Initialize sharesReceived
        });
      }
      setUser(user);
    } else {
      setUser(null);
    }
    setLoading(false);
  }, []);


  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      handleUser(user);
    });

    // Check for redirect result on initial load
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          handleUser(result.user);
        }
      })
      .catch((error) => {
        console.error('Error getting redirect result:', error);
      })
      .finally(() => {
        setLoading(false);
      });

    return () => unsubscribe();
  }, [handleUser]);

  return {user, loading, signInWithGoogle, logout};
}
