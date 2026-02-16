import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface AppConfig {
    repo: string | null;
    contentDir: string;
    assetsDir: string;
}

interface AppContextType {
    config: AppConfig;
    updateConfig: (newConfig: Partial<AppConfig>) => Promise<void>;
    resetConfig: () => Promise<void>;
    isConfigLoading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = 'flux_app_config';

const DEFAULT_CONFIG: AppConfig = {
    repo: null,
    contentDir: 'content/posts',
    assetsDir: 'static/assets',
};

export function AppProvider({ children }: { children: React.ReactNode }) {
    const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
    const [isConfigLoading, setIsConfigLoading] = useState(true);

    useEffect(() => {
        const loadConfig = async () => {
            try {
                const stored = await AsyncStorage.getItem(STORAGE_KEY);
                if (stored) {
                    setConfig(JSON.parse(stored));
                }
            } catch (e) {
                console.error('[AppContext] Failed to load config', e);
            } finally {
                setIsConfigLoading(false);
            }
        };
        loadConfig();
    }, []);

    const updateConfig = async (newConfig: Partial<AppConfig>) => {
        const updated = { ...config, ...newConfig };
        setConfig(updated);
        try {
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch (e) {
            console.error('[AppContext] Failed to save config', e);
        }
    };

    const resetConfig = async () => {
        setConfig(DEFAULT_CONFIG);
        try {
            await AsyncStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            console.error('[AppContext] Failed to reset config', e);
        }
    };

    return (
        <AppContext.Provider value={{ config, updateConfig, resetConfig, isConfigLoading }}>
            {children}
        </AppContext.Provider>
    );
}

export function useAppContext() {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useAppContext must be used within an AppProvider');
    }
    return context;
}
