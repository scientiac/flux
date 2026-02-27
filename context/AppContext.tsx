import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AppToast from '../components/AppToast';

interface RepoConfig {
    contentDir: string;
    useStaticFolder?: boolean;
    staticDir: string;
    assetsDir: string;
    postTemplate: string;
    siteUrl?: string;
    showAdvancedFiles?: boolean;
    syncSettingsToGitHub?: boolean;
}

interface AppConfig {
    repo: string | null;
    repoConfigs: { [repoPath: string]: RepoConfig };
}

export interface Draft {
    id: string;
    title: string;
    content: string;
    lastModified: string;
    repoPath: string;
    dirPath?: string;
}

export interface AppContextType {
    config: AppConfig;
    updateConfig: (newConfig: Partial<AppConfig>) => Promise<void>;
    updateRepoConfig: (repoPath: string, repoConfig: Partial<RepoConfig>) => Promise<void>;
    removeRepoConfig: (repoPath: string) => Promise<void>;
    resetConfig: () => Promise<void>;
    isConfigLoading: boolean;
    hasAutoRedirected: boolean;
    setHasAutoRedirected: (val: boolean) => void;
    // Decoupled Caches
    cachedRepos: any[];
    setCachedRepos: (repos: any[]) => Promise<void>;
    repoCache: { [repoPath: string]: any[] };
    setRepoFileCache: (repoPath: string, files: any[]) => Promise<void>;
    assetCache: { [repoPath: string]: any[] };
    setRepoAssetCache: (repoPath: string, assets: any[]) => Promise<void>;
    localDrafts: Draft[];
    saveDraft: (draft: Draft) => Promise<void>;
    deleteDraft: (draftId: string) => Promise<void>;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = 'flux_settings_v3';
const REPO_CACHE_KEY = 'flux_cache_repos';
const FILE_CACHE_PREFIX = 'flux_cache_files_';
const ASSET_CACHE_PREFIX = 'flux_cache_assets_';
const DRAFTS_KEY = 'flux_local_drafts';

const DEFAULT_REPO_CONFIG: RepoConfig = {
    contentDir: 'content/posts',
    useStaticFolder: true,
    staticDir: 'static',
    assetsDir: 'assets',
    postTemplate: "---\ntitle: {{title}}\ndate: {{date}}\ndraft: true\n---\n\n",
    syncSettingsToGitHub: true
};

const DEFAULT_CONFIG: AppConfig = {
    repo: null,
    repoConfigs: {},
};

export function AppProvider({ children }: { children: React.ReactNode }) {
    const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
    const [isConfigLoading, setIsConfigLoading] = useState(true);
    const [hasAutoRedirected, setHasAutoRedirected] = useState(false);
    const [cachedRepos, setCachedReposInternal] = useState<any[]>([]);
    const [repoCache, setRepoCache] = useState<{ [repoPath: string]: any[] }>({});
    const [assetCache, setAssetCache] = useState<{ [repoPath: string]: any[] }>({});
    const [localDrafts, setLocalDrafts] = useState<Draft[]>([]);
    const [toast, setToast] = useState({ visible: false, message: '', type: 'info' as 'success' | 'error' | 'info' });

    const settingsPendingSave = useRef<boolean>(false);
    const cachePendingSave = useRef<{ [repoPath: string]: boolean }>({});

    // Initial Load - Settings & Repos
    useEffect(() => {
        const init = async () => {
            try {
                const [storedSettings, storedRepos, storedDrafts] = await Promise.all([
                    AsyncStorage.getItem(STORAGE_KEY),
                    AsyncStorage.getItem(REPO_CACHE_KEY),
                    AsyncStorage.getItem(DRAFTS_KEY),
                ]);

                if (storedSettings) setConfig(JSON.parse(storedSettings));
                if (storedRepos) setCachedReposInternal(JSON.parse(storedRepos));
                if (storedDrafts) setLocalDrafts(JSON.parse(storedDrafts));

                // Load active repo's file and asset cache if exists
                const activeRepo = JSON.parse(storedSettings || '{}').repo;
                if (activeRepo) {
                    const [storedFiles, storedAssets] = await Promise.all([
                        AsyncStorage.getItem(FILE_CACHE_PREFIX + activeRepo),
                        AsyncStorage.getItem(ASSET_CACHE_PREFIX + activeRepo)
                    ]);
                    if (storedFiles) {
                        setRepoCache(prev => ({ ...prev, [activeRepo]: JSON.parse(storedFiles) }));
                    }
                    if (storedAssets) {
                        setAssetCache(prev => ({ ...prev, [activeRepo]: JSON.parse(storedAssets) }));
                    }
                }
            } catch (e) {
                console.error('[AppContext] Init failed', e);
            } finally {
                setIsConfigLoading(false);
            }
        };
        init();
    }, []);

    // Debounced Settings Persistence
    useEffect(() => {
        if (isConfigLoading || !settingsPendingSave.current) return;
        const timer = setTimeout(async () => {
            try {
                await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
                settingsPendingSave.current = false;
                console.log('[AppContext] Settings persisted');
            } catch (e) {
                console.error('[AppContext] Settings save failed', e);
            }
        }, 800);
        return () => clearTimeout(timer);
    }, [config, isConfigLoading]);

    // Debounced Repo & Asset Cache Persistence
    useEffect(() => {
        if (isConfigLoading) return;
        const reposToSave = Object.entries(cachePendingSave.current).filter(([_, pending]) => pending);
        if (reposToSave.length === 0) return;

        const timer = setTimeout(async () => {
            for (const [repoPath, _] of reposToSave) {
                try {
                    const fileData = repoCache[repoPath];
                    const assetData = assetCache[repoPath];

                    const promises = [];
                    if (fileData) promises.push(AsyncStorage.setItem(FILE_CACHE_PREFIX + repoPath, JSON.stringify(fileData)));
                    if (assetData) promises.push(AsyncStorage.setItem(ASSET_CACHE_PREFIX + repoPath, JSON.stringify(assetData)));

                    if (promises.length > 0) {
                        await Promise.all(promises);
                        cachePendingSave.current[repoPath] = false;
                        console.log(`[AppContext] Cache for ${repoPath} persisted`);
                    }
                } catch (e) {
                    console.error(`[AppContext] Cache save failed for ${repoPath}`, e);
                }
            }
        }, 1500); // Longer debounce for heavy file lists

        return () => clearTimeout(timer);
    }, [repoCache, assetCache, isConfigLoading]);

    const updateConfig = useCallback(async (newFields: Partial<AppConfig>) => {
        settingsPendingSave.current = true;
        setConfig(prev => ({ ...prev, ...newFields }));
    }, []);

    const updateRepoConfig = useCallback(async (repoPath: string, repoConfig: Partial<RepoConfig>) => {
        settingsPendingSave.current = true;
        setConfig(prev => ({
            ...prev,
            repoConfigs: {
                ...prev.repoConfigs,
                [repoPath]: { ...(prev.repoConfigs[repoPath] || DEFAULT_REPO_CONFIG), ...repoConfig }
            }
        }));
    }, []);

    const removeRepoConfig = useCallback(async (repoPath: string) => {
        settingsPendingSave.current = true;
        setConfig(prev => {
            const newConfigs = { ...prev.repoConfigs };
            delete newConfigs[repoPath];
            return {
                ...prev,
                repo: prev.repo === repoPath ? null : prev.repo,
                repoConfigs: newConfigs,
            };
        });
        // Clear caches for this repo
        setRepoCache(prev => { const n = { ...prev }; delete n[repoPath]; return n; });
        setAssetCache(prev => { const n = { ...prev }; delete n[repoPath]; return n; });
        try {
            await AsyncStorage.removeItem(`${FILE_CACHE_PREFIX}${repoPath}`);
            await AsyncStorage.removeItem(`${ASSET_CACHE_PREFIX}${repoPath}`);
            // Remove drafts for this repo
            setLocalDrafts(prev => {
                const updated = prev.filter(d => d.repoPath !== repoPath);
                AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(updated));
                return updated;
            });
        } catch (e) {
            console.error('[AppContext] Failed to clear repo data', e);
        }
    }, []);

    const setCachedRepos = useCallback(async (repos: any[]) => {
        setCachedReposInternal(repos);
        try {
            await AsyncStorage.setItem(REPO_CACHE_KEY, JSON.stringify(repos));
        } catch (e) {
            console.error('[AppContext] Repo cache failed', e);
        }
    }, []);

    const setRepoFileCache = useCallback(async (repoPath: string, files: any[]) => {
        cachePendingSave.current[repoPath] = true;
        setRepoCache(prev => ({ ...prev, [repoPath]: files }));
    }, []);

    const setRepoAssetCache = useCallback(async (repoPath: string, assets: any[]) => {
        cachePendingSave.current[repoPath] = true;
        setAssetCache(prev => ({ ...prev, [repoPath]: assets }));
    }, []);

    const saveDraft = useCallback(async (draft: Draft) => {
        setLocalDrafts(prev => {
            const index = prev.findIndex(d => d.id === draft.id);
            let updated;
            if (index > -1) {
                updated = [...prev];
                updated[index] = draft;
            } else {
                updated = [draft, ...prev];
            }
            AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(updated));
            return updated;
        });
    }, []);

    const deleteDraft = useCallback(async (draftId: string) => {
        setLocalDrafts(prev => {
            const updated = prev.filter(d => d.id !== draftId);
            AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(updated));
            return updated;
        });
    }, []);

    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
        setToast({ visible: true, message, type });
    }, []);

    const resetConfig = useCallback(async () => {
        setConfig(DEFAULT_CONFIG);
        setCachedReposInternal([]);
        setRepoCache({});
        setAssetCache({});
        const keys = await AsyncStorage.getAllKeys();
        const toDelete = keys.filter(k => k.startsWith('flux_'));
        await AsyncStorage.multiRemove(toDelete);
    }, []);

    const contextValue = useMemo(() => ({
        config,
        updateConfig,
        updateRepoConfig,
        removeRepoConfig,
        resetConfig,
        isConfigLoading,
        hasAutoRedirected,
        setHasAutoRedirected,
        cachedRepos,
        setCachedRepos,
        repoCache,
        setRepoFileCache,
        assetCache,
        setRepoAssetCache,
        localDrafts,
        saveDraft,
        deleteDraft,
        showToast
    }), [config, isConfigLoading, hasAutoRedirected, cachedRepos, repoCache, assetCache, localDrafts, showToast]);

    return (
        <AppContext.Provider value={contextValue}>
            {children}
            <AppToast
                visible={toast.visible}
                message={toast.message}
                type={toast.type}
                onDismiss={() => setToast(prev => ({ ...prev, visible: false }))}
            />
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
