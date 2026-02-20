import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Buffer } from 'buffer';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as ExpoSplashScreen from 'expo-splash-screen';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, Dimensions, FlatList, Platform, RefreshControl, StyleSheet, UIManager, View } from 'react-native';
import { Appbar, Avatar, Button, Dialog, FAB, IconButton, Portal, Searchbar, SegmentedButtons, Snackbar, Surface, Text, TextInput, TouchableRipple, useTheme } from 'react-native-paper';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useAppContext } from '../context/AppContext';

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 2;
const ASSET_ITEM_SIZE = (width - 48) / COLUMN_COUNT;

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Inline sliding tab container
const SlidingTabContainer = ({ children, selectedIndex }: { children: React.ReactNode[]; selectedIndex: number }) => {
    const translateX = useSharedValue(0);
    useEffect(() => {
        translateX.value = withTiming(-selectedIndex * width, {
            duration: 300,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        });
    }, [selectedIndex]);
    const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
    return (
        <View style={{ flex: 1, overflow: 'hidden' }}>
            <Animated.View style={[{ flexDirection: 'row', flex: 1 }, animatedStyle, { width: width * React.Children.count(children) }]}>
                {React.Children.map(children, (child, i) => (
                    <View key={i} style={{ width, flex: 1 }}>{child}</View>
                ))}
            </Animated.View>
        </View>
    );
};

// Helper to format relative dates like GitHub/Gmail
const formatRelativeDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Sub-component for Image Naming Dialog
const ImageNameDialog = ({ visible, onDismiss, onConfirm, initialValue }: { visible: boolean, onDismiss: () => void, onConfirm: (val: string) => void, initialValue: string }) => {
    const theme = useTheme();
    const [localValue, setLocalValue] = useState(initialValue);
    useEffect(() => { if (visible) setLocalValue(initialValue); }, [visible, initialValue]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>Upload Image</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    label="Filename"
                    value={localValue}
                    onChangeText={setLocalValue}
                    mode="flat"
                    autoFocus
                    style={{ backgroundColor: theme.colors.surfaceVariant }}
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button mode="contained" onPress={() => onConfirm(localValue)} style={{ borderRadius: 20 }}>Upload</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

// Sub-component for Rename Dialog
const RenameDialog = ({ visible, onDismiss, onRename, initialValue, title = "Rename", label = "Name" }: { visible: boolean, onDismiss: () => void, onRename: (val: string) => void, initialValue: string, title?: string, label?: string }) => {
    const theme = useTheme();
    const [localValue, setLocalValue] = useState(initialValue);

    useEffect(() => { if (visible) setLocalValue(initialValue); }, [visible, initialValue]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    label={label}
                    value={localValue}
                    onChangeText={setLocalValue}
                    mode="flat"
                    autoFocus
                    style={[styles.dialogInput, { backgroundColor: theme.colors.surfaceVariant }]}
                    selectionColor={theme.colors.primary}
                    activeUnderlineColor={theme.colors.primary}
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button onPress={() => onRename(localValue)} disabled={!localValue} mode="contained" style={{ borderRadius: 20 }}>Confirm</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

// Sub-component for New Post Dialog
const NewFileDialog = ({ visible, onDismiss, onCreate, title, label }: { visible: boolean, onDismiss: () => void, onCreate: (val: string) => void, title: string, label: string }) => {
    const theme = useTheme();
    const [localValue, setLocalValue] = useState('');
    useEffect(() => { if (visible) setLocalValue(''); }, [visible]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    placeholder={label}
                    value={localValue}
                    onChangeText={setLocalValue}
                    mode="flat"
                    autoFocus
                    style={[styles.dialogInput, { backgroundColor: theme.colors.surfaceVariant }]}
                    selectionColor={theme.colors.primary}
                    activeUnderlineColor={theme.colors.primary}
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button onPress={() => onCreate(localValue)} disabled={!localValue} mode="contained" style={{ borderRadius: 20 }}>{title.split(' ')[0]}</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

// Sub-component for Publish Draft Dialog
const PublishDraftDialog = ({ visible, onDismiss, onPublish, initialTitle }: { visible: boolean, onDismiss: () => void, onPublish: (commitMsg: string) => void, initialTitle: string }) => {
    const theme = useTheme();
    const [commitMsg, setCommitMsg] = useState(`Create ${initialTitle}`);

    useEffect(() => {
        if (visible) {
            setCommitMsg(`Create ${initialTitle}`);
        }
    }, [visible, initialTitle]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>Publish to GitHub</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    label="Commit Message"
                    value={commitMsg}
                    onChangeText={setCommitMsg}
                    mode="flat"
                    style={{ backgroundColor: theme.colors.surfaceVariant }}
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button mode="contained" onPress={() => onPublish(commitMsg)} style={{ borderRadius: 20 }}>Push</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

// Sub-component for Asset Item
const AssetItem = memo(({ item, headers, onRename, onDelete }: { item: any, headers: any, onRename: () => void, onDelete: () => void }) => {
    const theme = useTheme();
    return (
        <View style={[styles.assetCard, { backgroundColor: theme.colors.surfaceVariant }]}>
            <View style={styles.assetThumbContainer}>
                <Image
                    source={{ uri: item.download_url, headers }}
                    style={styles.assetImage}
                    contentFit="cover"
                    cachePolicy="disk"
                />
                <View style={styles.assetOverlay}>
                    <IconButton
                        icon="cursor-text"
                        mode="contained"
                        containerColor="rgba(0,0,0,0.5)"
                        iconColor="white"
                        size={16}
                        onPress={onRename}
                        style={{ margin: 2 }}
                    />
                    <IconButton
                        icon="delete"
                        mode="contained"
                        containerColor="rgba(0,0,0,0.5)"
                        iconColor={theme.colors.error}
                        size={16}
                        onPress={onDelete}
                        style={{ margin: 2 }}
                    />
                </View>
            </View>
            <View style={{ backgroundColor: theme.colors.surface, padding: 4 }}>
                <Text variant="bodySmall" numberOfLines={1} style={styles.assetName}>{item.name}</Text>
            </View>
        </View>
    );
});

// Sub-component for Draft Item
// Sub-component for DraftItem
const DraftItem = memo(({ item, onPress, onDelete, onPublish, onRename }: { item: any, onPress: () => void, onDelete: () => void, onPublish: () => void, onRename: () => void }) => {
    const theme = useTheme();
    return (
        <Surface elevation={1} style={{ borderRadius: 16, overflow: 'hidden', marginVertical: 4, marginHorizontal: 0, backgroundColor: theme.colors.surface }}>
            <TouchableRipple onPress={onPress} style={{ flex: 1 }} rippleColor={theme.colors.onSurfaceVariant + '1F'} borderless={true}>
                <View style={[styles.draftCard, { backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0 }]}>
                    <View style={styles.draftHeader}>
                        <Text variant="titleMedium" numberOfLines={1} style={styles.draftTitle}>
                            {(item.title ? item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : 'untitled') + '.md'}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                            <IconButton mode="contained-tonal" icon="cursor-text" size={18} iconColor={theme.colors.primary} onPress={onRename} />
                            <IconButton mode="contained-tonal" icon="cloud-upload-outline" size={18} iconColor={theme.colors.primary} onPress={onPublish} />
                            <IconButton mode="contained-tonal" icon="delete-outline" size={18} iconColor={theme.colors.error} onPress={onDelete} />
                        </View>
                    </View>
                    <Text variant="labelSmall" style={styles.draftDate}>
                        {formatRelativeDate(item.lastModified)}
                    </Text>
                </View>
            </TouchableRipple>
        </Surface>
    );
});

const FileItem = memo(({ item, onRename, onDelete, onPress }: { item: any, onRename: () => void, onDelete: () => void, onPress: () => void }) => {
    const theme = useTheme();
    return (
        <Surface elevation={1} style={{ borderRadius: 16, overflow: 'hidden', marginVertical: 4, marginHorizontal: 0, backgroundColor: theme.colors.surface }}>
            <TouchableRipple onPress={onPress} style={{ flex: 1 }} rippleColor={theme.colors.onSurfaceVariant + '1F'} borderless={true}>
                <View style={[styles.draftCard, { backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0 }]}>
                    <View style={styles.draftHeader}>
                        <Text variant="titleMedium" numberOfLines={1} style={styles.draftTitle}>{item.name}</Text>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                            <IconButton mode="contained-tonal" icon="cursor-text" size={18} iconColor={theme.colors.primary} onPress={onRename} />
                            <IconButton mode="contained-tonal" icon="delete-outline" size={18} iconColor={theme.colors.error} onPress={onDelete} />
                        </View>
                    </View>
                    {item.lastModified && (
                        <Text variant="labelSmall" style={styles.draftDate}>
                            {formatRelativeDate(item.lastModified)}
                        </Text>
                    )}
                </View>
            </TouchableRipple>
        </Surface>
    );
});

// Sub-component for Directory Item
const DirItem = memo(({ item, onPress }: { item: any, onPress: () => void }) => {
    const theme = useTheme();
    const isBack = item._isBack;
    return (
        <Surface elevation={1} style={{ borderRadius: 16, overflow: 'hidden', marginVertical: 4, marginHorizontal: 0, backgroundColor: theme.colors.surface }}>
            <TouchableRipple onPress={onPress} style={{ flex: 1 }} rippleColor={theme.colors.onSurfaceVariant + '1F'} borderless={true}>
                <View style={[styles.draftCard, { backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <Avatar.Icon size={40} icon={isBack ? 'arrow-up' : 'folder'} style={{ backgroundColor: isBack ? theme.colors.surfaceVariant : theme.colors.primaryContainer }} color={isBack ? theme.colors.onSurfaceVariant : theme.colors.primary} />
                        <Text variant="titleMedium" numberOfLines={1} style={{ flex: 1, fontWeight: 'bold', color: isBack ? theme.colors.onSurfaceVariant : theme.colors.onSurface }}>{item.name}</Text>
                        {!isBack && <IconButton icon="chevron-right" size={20} iconColor={theme.colors.onSurfaceVariant} />}
                    </View>
                </View>
            </TouchableRipple>
        </Surface>
    );
});


export default function Files() {
    const { config, repoCache, setRepoFileCache, assetCache, setRepoAssetCache, localDrafts, saveDraft, deleteDraft } = useAppContext();
    const theme = useTheme();
    const router = useRouter();

    const [mode, setMode] = useState<'posts' | 'drafts' | 'assets'>('posts');
    const selectedIndex = ['posts', 'drafts', 'assets'].indexOf(mode);

    const segmentedButtons = useMemo(() => [
        { value: 'posts', label: 'Posts', icon: 'file-document-outline' },
        { value: 'drafts', label: 'Drafts', icon: 'pencil-box-outline' },
        { value: 'assets', label: 'Assets', icon: 'image-multiple-outline' },
    ], []);

    const repoPath = config.repo;
    const repoConfig = repoPath ? config.repoConfigs[repoPath] : null;

    const [currentDir, setCurrentDir] = useState(''); // relative path within contentDir
    const [files, setFiles] = useState<any[]>(repoPath ? (repoCache[repoPath] || []) : []);
    const [assets, setAssets] = useState<any[]>(repoPath ? (assetCache[repoPath] || []) : []);
    const [isLoading, setIsLoading] = useState(false);
    const [githubToken, setGithubToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isInitialLoading, setIsInitialLoading] = useState(
        repoPath ? !(repoCache[repoPath]?.length > 0) : false
    );
    const [hasLoadedPosts, setHasLoadedPosts] = useState(false);
    const [hasLoadedAssets, setHasLoadedAssets] = useState(false);

    const [isNewFileVisible, setIsNewFileVisible] = useState(false);
    const [isNewDraftVisible, setIsNewDraftVisible] = useState(false);
    const [isRenameVisible, setIsRenameVisible] = useState(false);
    const [isDeleteVisible, setIsDeleteVisible] = useState(false);
    const [selectedFile, setSelectedFile] = useState<any>(null);
    const [selectedAsset, setSelectedAsset] = useState<any>(null);

    const [isImageNameVisible, setIsImageNameVisible] = useState(false);
    const [pendingImage, setPendingImage] = useState<any>(null);

    const [snackbarVisible, setSnackbarVisible] = useState(false);
    const [snackbarMsg, setSnackbarMsg] = useState('');

    const [isPublishDialogVisible, setIsPublishDialogVisible] = useState(false);
    const [selectedDraft, setSelectedDraft] = useState<any>(null);
    const [isDeleteDraftVisible, setIsDeleteDraftVisible] = useState(false);
    const [isRenameDraftVisible, setIsRenameDraftVisible] = useState(false);
    const [tombstones, setTombstones] = useState<Set<string>>(new Set());

    useEffect(() => {
        SecureStore.getItemAsync('github_access_token').then(setGithubToken);
    }, []);

    // Sync assets from cache (e.g. from Editor updates)
    useEffect(() => {
        if (repoPath && assetCache[repoPath]) {
            setAssets(assetCache[repoPath]);
        }
    }, [assetCache, repoPath]);

    useEffect(() => {
        const onBackPress = () => {
            // If we are inside a subdirectory in posts mode, navigate up
            if (mode === 'posts' && currentDir) {
                setFiles([]); // Clear immediately
                setIsLoading(true);
                const parentDir = currentDir.includes('/') ? currentDir.substring(0, currentDir.lastIndexOf('/')) : '';
                setCurrentDir(parentDir);
                return true;
            }
            // Prevent going back to repo list. Minimize app or do nothing.
            BackHandler.exitApp();
            return true;
        };

        const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
        return () => subscription.remove();
    }, [mode, currentDir]);

    const fetchFiles = useCallback(async (isManualRefresh = false) => {
        if (!repoPath || !repoConfig) return;
        if (isManualRefresh) {
            setIsLoading(true);
            setTombstones(new Set());
            // Clear all local autosaves related to this repo to force fresh fetch
            const allKeys = await AsyncStorage.getAllKeys();
            const repoAutosaves = allKeys.filter((k: string) => k.startsWith('flux_draft_') && k.includes(encodeURIComponent(repoConfig.contentDir)));
            if (repoAutosaves.length > 0) await AsyncStorage.multiRemove(repoAutosaves);
        }
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            // Build the full path: contentDir + currentDir
            const fetchPath = currentDir
                ? `${repoConfig.contentDir}/${currentDir}`.replace(/\/+/g, '/')
                : repoConfig.contentDir;
            const filesResponse = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${fetchPath}`, {
                headers: {
                    Authorization: `token ${token}`,
                    'Cache-Control': 'no-cache'
                }
            });
            if (Array.isArray(filesResponse.data)) {
                // Get directories
                const dirs = filesResponse.data.filter((f: any) => f.type === 'dir').map((d: any) => ({ ...d, _isDir: true }));
                // Get markdown files
                let mdFiles = filesResponse.data.filter((f: any) => f.type === 'file' && f.name.match(/\.(md|markdown)$/i));

                // Fetch commit dates in parallel to show "last modified"
                mdFiles = await Promise.all(mdFiles.map(async (file: any) => {
                    try {
                        const commitRes = await axios.get(`https://api.github.com/repos/${repoPath}/commits?path=${encodeURIComponent(file.path)}&per_page=1`, {
                            headers: { Authorization: `token ${token}` }
                        });
                        if (commitRes.data && commitRes.data.length > 0) {
                            return { ...file, lastModified: commitRes.data[0].commit.committer.date };
                        }
                    } catch (e) {
                        console.error(`[Files] Failed to fetch commit for ${file.name}`, e);
                    }
                    return file;
                }));

                // Combine: dirs first, then files
                const combined = [...dirs, ...mdFiles];
                setFiles(combined);
                await setRepoFileCache(repoPath, combined);
            }
        } catch (e: any) {
            if (e.response?.status === 404) {
                setFiles([]);
                await setRepoFileCache(repoPath, []);
            } else {
                console.error('[Files] Fetch failed', e);
            }
        } finally {
            setIsLoading(false);
            setIsInitialLoading(false);
            setHasLoadedPosts(true);
            ExpoSplashScreen.hideAsync();
        }
    }, [repoPath, repoConfig, setRepoFileCache, currentDir]);

    const fetchAssets = useCallback(async (isManualRefresh = false) => {
        if (!repoPath || !repoConfig) return;
        if (isManualRefresh) {
            setIsLoading(true);
            setTombstones(new Set());
        }
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const cleanStatic = repoConfig.staticDir?.replace(/^\/+|\/+$/g, '') || '';
            const cleanAssets = repoConfig.assetsDir?.replace(/^\/+|\/+$/g, '') || '';
            const fullPath = [cleanStatic, cleanAssets].filter(Boolean).join('/');

            const response = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${fullPath}`, {
                headers: {
                    Authorization: `token ${token}`,
                    'Cache-Control': 'no-cache'
                }
            });
            if (Array.isArray(response.data)) {
                const imageFiles = response.data.filter((f: any) => f.type === 'file' && f.name.match(/\.(jpg|jpeg|png|gif|webp)$/i));
                setAssets(imageFiles);
                await setRepoAssetCache(repoPath, imageFiles);
            }
        } catch (e: any) {
            if (e.response?.status === 404) {
                setAssets([]);
                await setRepoAssetCache(repoPath, []);
            } else {
                console.error('[Assets] Fetch failed', e);
            }
        } finally {
            setIsLoading(false);
            setIsInitialLoading(false);
            setHasLoadedAssets(true);
            ExpoSplashScreen.hideAsync();
        }
    }, [repoPath, repoConfig?.staticDir, repoConfig?.assetsDir, setRepoAssetCache]);

    useEffect(() => {
        if (repoPath) {
            if (mode === 'posts') fetchFiles();
            else if (mode === 'assets') fetchAssets();
        }
    }, [repoPath, mode, fetchFiles, fetchAssets, currentDir]);

    // Refresh on focus to ensure newly published posts show up immediately
    useFocusEffect(
        useCallback(() => {
            if (repoPath) {
                if (mode === 'posts') fetchFiles();
                else if (mode === 'assets') fetchAssets();
            }
        }, [repoPath, mode, fetchFiles, fetchAssets])
    );

    const handlePublishDraft = useCallback(async (commitMsg: string) => {
        if (!selectedDraft || !repoPath || !repoConfig) return;
        setIsPublishDialogVisible(false);
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            if (!token) throw new Error('Not authenticated');

            // Use drafting title normalized as filename
            const normalized = selectedDraft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const extFilename = `${normalized}.md`;
            // Publish to current directory if browsing a subdirectory
            const dirPath = currentDir
                ? `${repoConfig.contentDir}/${currentDir}`.replace(/\/+/g, '/')
                : repoConfig.contentDir;
            const cleanPostPath = `${dirPath}/${extFilename}`.replace(/^\/+/, '').replace(/\/+/g, '/');

            // Check if file exists to get SHA (prevent "sha wasn't supplied" error)
            let currentSha = undefined;
            try {
                const checkRes = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${cleanPostPath}`, {
                    headers: { Authorization: `token ${token}`, 'Cache-Control': 'no-cache' }
                });
                currentSha = checkRes.data.sha;
            } catch (e: any) {
                if (e.response?.status !== 404) throw e;
            }

            // Simple publish for draft content
            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${cleanPostPath}`, {
                message: commitMsg,
                content: Buffer.from(selectedDraft.content).toString('base64'),
                sha: currentSha
            }, {
                headers: { Authorization: `token ${token}` }
            });

            await deleteDraft(selectedDraft.id);
            setSnackbarMsg('Published to GitHub');
            setSnackbarVisible(true);
            fetchFiles();
        } catch (e: any) {
            console.error('[Files] Publish draft failed', e);
            setSnackbarMsg(`Publish failed: ${e.response?.data?.message || e.message}`);
            setSnackbarVisible(true);
        } finally {
            setIsLoading(false);
            setSelectedDraft(null);
        }
    }, [selectedDraft, repoPath, repoConfig, deleteDraft, fetchFiles, currentDir]);

    const handleAction = useCallback(() => {
        if (mode === 'posts') setIsNewFileVisible(true);
        else if (mode === 'drafts') setIsNewDraftVisible(true);
        else if (mode === 'assets') pickImage();
    }, [mode]);

    const handleCreateDraft = useCallback(async (title: string) => {
        if (!repoConfig) return;
        const id = Date.now().toString();
        const date = new Date().toISOString().split('T')[0];

        // Use custom template or fallback
        let template = repoConfig.postTemplate || "+++  \ntitle: {{title}}  \ndate: {{date}}  \ntime: {{time}}  \n+++\n\n";
        const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
        template = template.replace(/{{title}}/g, title).replace(/{{date}}/g, date).replace(/{{time}}/g, time);

        await saveDraft({
            id,
            title: title || 'New Draft',
            content: template,
            lastModified: new Date().toISOString(),
            repoPath: repoPath || ''
        });
        setIsNewDraftVisible(false);
        router.push(`/editor/draft_${id}?new=true`);
    }, [repoConfig, repoPath, saveDraft, router]);

    const handleCreateFile = useCallback(async (name: string) => {
        if (!repoConfig) return;
        const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const cleanName = `${normalized}.md`;
        // Create in the current directory
        const dirPath = currentDir
            ? `${repoConfig.contentDir}/${currentDir}`.replace(/\/+/g, '/')
            : repoConfig.contentDir;
        const path = `${dirPath}/${cleanName}`;
        setIsNewFileVisible(false);
        router.push(`/editor/${encodeURIComponent(path)}?new=true&title=${encodeURIComponent(name)}`);
    }, [repoConfig, router, currentDir]);

    const handleDeleteFile = useCallback(async () => {
        if (!selectedFile || !repoPath) return;
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedFile.path}`, {
                headers: { Authorization: `token ${token}` },
                data: { message: `Delete ${selectedFile.name}`, sha: selectedFile.sha }
            });
            setTombstones(prev => new Set(prev).add(selectedFile.path));
            const updated = files.filter(f => f.path !== selectedFile.path);
            setFiles(updated);
            await setRepoFileCache(repoPath, updated);
            setSnackbarMsg(`${selectedFile.name} deleted`);
            setSnackbarVisible(true);
        } catch (e: any) {
            setSnackbarMsg(`Delete failed: ${e.message}`);
            setSnackbarVisible(true);
        } finally {
            setIsLoading(false);
            setIsDeleteVisible(false);
            setSelectedFile(null);
        }
    }, [selectedFile, repoPath, files, setRepoFileCache]);

    const handleRenameDraft = async (newTitle: string) => {
        if (!selectedDraft || !newTitle) return;
        await saveDraft({
            ...selectedDraft,
            title: newTitle,
            lastModified: new Date().toISOString()
        });
        setIsRenameDraftVisible(false);
        setSelectedDraft(null);
        setSnackbarMsg(`Renamed draft to ${newTitle}`);
        setSnackbarVisible(true);
    };

    const handleRenameFile = useCallback(async (newName: string) => {
        if (!selectedFile || !newName || !repoPath || !repoConfig) return;
        const cleanName = newName.endsWith('.md') ? newName : `${newName}.md`;
        if (cleanName === selectedFile.name) {
            setIsRenameVisible(false);
            return;
        }
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const response = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${selectedFile.path}`, {
                headers: { Authorization: `token ${token}` }
            });
            // Rename within the same directory as the original file
            const parentDir = selectedFile.path.substring(0, selectedFile.path.lastIndexOf('/'));
            const newPath = `${parentDir}/${cleanName}`;
            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, {
                message: `Rename ${selectedFile.name} to ${cleanName}`,
                content: response.data.content,
            }, { headers: { Authorization: `token ${token}` } });
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedFile.path}`, {
                headers: { Authorization: `token ${token}` },
                data: { message: `Delete old file after rename`, sha: selectedFile.sha }
            });
            const updatedFiles = files.map(f => f.sha === selectedFile.sha ? { ...f, name: cleanName, path: newPath } : f);
            setFiles(updatedFiles);
            await setRepoFileCache(repoPath, updatedFiles);
            setSnackbarMsg(`Renamed to ${cleanName}`);
            setSnackbarVisible(true);
        } catch (e: any) {
            setSnackbarMsg(`Rename failed: ${e.message}`);
            setSnackbarVisible(true);
        } finally {
            setIsLoading(false);
            setIsRenameVisible(false);
            setSelectedFile(null);
        }
    }, [selectedFile, repoPath, repoConfig, files, setRepoFileCache]);

    const handleDeleteAsset = useCallback(async () => {
        if (!selectedAsset || !repoPath) return;
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedAsset.path}`, {
                headers: { Authorization: `token ${token}` },
                data: { message: `Delete asset ${selectedAsset.name}`, sha: selectedAsset.sha }
            });
            setTombstones(prev => new Set(prev).add(selectedAsset.path));
            const updated = assets.filter(f => f.path !== selectedAsset.path);
            setAssets(updated);
            await setRepoAssetCache(repoPath, updated);
            setSnackbarMsg(`${selectedAsset.name} deleted`);
            setSnackbarVisible(true);
        } catch (e: any) {
            setSnackbarMsg(`Delete failed: ${e.message}`);
            setSnackbarVisible(true);
        } finally {
            setIsLoading(false);
            setIsDeleteVisible(false);
            setSelectedAsset(null);
        }
    }, [selectedAsset, repoPath, assets, setRepoAssetCache]);

    const handleRenameAsset = async (newName: string) => {
        if (!selectedAsset || !newName || !repoPath || !repoConfig) return;
        const ext = selectedAsset.name.split('.').pop();
        const cleanName = newName.includes('.') ? newName : `${newName}.${ext}`;
        const cleanStatic = repoConfig.staticDir?.replace(/^\/+|\/+$/g, '') || '';
        const cleanAssets = repoConfig.assetsDir?.replace(/^\/+|\/+$/g, '') || '';
        const fullAssetsPath = [cleanStatic, cleanAssets].filter(Boolean).join('/');
        const newPath = `${fullAssetsPath}/${cleanName}`.replace(/^\/+/, '').replace(/\/+/g, '/');
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const contentRes = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${selectedAsset.path}`, {
                headers: { Authorization: `token ${token}` }
            });
            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, {
                message: `Rename ${selectedAsset.name}`,
                content: contentRes.data.content,
            }, { headers: { Authorization: `token ${token}` } });
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedAsset.path}`, {
                headers: { Authorization: `token ${token}` },
                data: { message: `Cleanup after rename`, sha: selectedAsset.sha }
            });
            const updated = assets.map(a => a.path === selectedAsset.path ? { ...a, name: cleanName, path: newPath } : a);
            setAssets(updated);
            await setRepoAssetCache(repoPath, updated);
            setSnackbarMsg(`Renamed to ${cleanName}`);
            setSnackbarVisible(true);
        } catch (e: any) {
            setSnackbarMsg(`Rename failed: ${e.message}`);
            setSnackbarVisible(true);
        } finally {
            setIsLoading(false);
            setIsRenameVisible(false);
            setSelectedAsset(null);
        }
    };

    const pickImage = useCallback(async () => {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
        if (!result.canceled) {
            const uri = result.assets[0].uri;
            const filename = uri.split('/').pop() || `img_${Date.now()}.jpg`;
            setPendingImage({ uri, filename });
            setIsImageNameVisible(true);
        }
    }, []);

    const confirmUpload = useCallback(async (filename: string) => {
        if (!pendingImage || !repoPath || !repoConfig) return;
        setIsImageNameVisible(false);
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const cleanStatic = repoConfig.staticDir?.replace(/^\/+|\/+$/g, '') || '';
            const cleanAssets = repoConfig.assetsDir?.replace(/^\/+|\/+$/g, '') || '';
            const fullAssetsPath = [cleanStatic, cleanAssets].filter(Boolean).join('/');
            const newPath = [fullAssetsPath, filename].filter(Boolean).join('/');
            const manip = await ImageManipulator.manipulateAsync(pendingImage.uri, [{ resize: { width: 1200 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, { message: `Upload ${filename}`, content: manip.base64 }, { headers: { Authorization: `token ${token}` } });
            setSnackbarMsg(`Uploaded ${filename}`);
            setSnackbarVisible(true);
            fetchAssets(true);
        } catch (e: any) {
            setSnackbarMsg(`Upload failed: ${e.message}`);
            setSnackbarVisible(true);
        } finally { setIsLoading(false); setPendingImage(null); }
    }, [pendingImage, repoPath, repoConfig, fetchAssets]);

    const handleRefreshPosts = useCallback(() => fetchFiles(true), [fetchFiles]);
    const handleRefreshAssets = useCallback(() => fetchAssets(true), [fetchAssets]);

    const postKeyExtractor = useCallback((item: any) => item.path, []);
    const assetKeyExtractor = useCallback((item: any) => item.sha, []);
    const draftKeyExtractor = useCallback((item: any) => item.id, []);

    const assetHeaders = useMemo(() => githubToken ? { Authorization: `token ${githubToken}` } : undefined, [githubToken]);

    const handleDirPress = useCallback((dirName: string) => {
        setFiles([]); // Clear immediately to avoid stale content
        setIsLoading(true);
        const newDir = currentDir ? `${currentDir}/${dirName}` : dirName;
        setCurrentDir(newDir);
    }, [currentDir]);

    const handleNavigateUp = useCallback(() => {
        setFiles([]); // Clear immediately
        setIsLoading(true);
        const parentDir = currentDir.includes('/') ? currentDir.substring(0, currentDir.lastIndexOf('/')) : '';
        setCurrentDir(parentDir);
    }, [currentDir]);

    const renderPostItem = useCallback(({ item }: any) => {
        if (item._isBack) {
            return <DirItem item={item} onPress={handleNavigateUp} />;
        }
        if (item._isDir) {
            return <DirItem item={item} onPress={() => handleDirPress(item.name)} />;
        }
        return (
            <FileItem
                item={item}
                onPress={() => router.push(`/editor/${encodeURIComponent(item.path)}`)}
                onRename={() => { setSelectedFile(item); setIsRenameVisible(true); }}
                onDelete={() => { setSelectedFile(item); setIsDeleteVisible(true); }}
            />
        );
    }, [router, handleDirPress, handleNavigateUp]);

    const renderDraftItem = useCallback(({ item }: any) => (
        <DraftItem
            item={item}
            onPress={() => router.push(`/editor/draft_${item.id}`)}
            onRename={() => { setSelectedDraft(item); setIsRenameDraftVisible(true); }}
            onPublish={() => { setSelectedDraft(item); setIsPublishDialogVisible(true); }}
            onDelete={() => { setSelectedDraft(item); setIsDeleteDraftVisible(true); }}
        />
    ), [router]);

    const renderAssetItem = useCallback(({ item }: any) => (
        <AssetItem
            item={item}
            headers={assetHeaders}
            onRename={() => { setSelectedAsset(item); setIsRenameVisible(true); }}
            onDelete={() => { setSelectedAsset(item); setIsDeleteVisible(true); }}
        />
    ), [assetHeaders]);

    const filteredFiles = useMemo(() => {
        const filtered = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()) && !tombstones.has(f.path));
        // Sort: directories first (alphabetical), then files
        const dirs = filtered.filter(f => f._isDir).sort((a: any, b: any) => a.name.localeCompare(b.name));
        const posts = filtered.filter(f => !f._isDir);
        const result = [...dirs, ...posts];
        // Prepend '..' back entry when inside a subdirectory
        if (currentDir) {
            result.unshift({ name: '..', path: '__back__', _isBack: true, _isDir: false });
        }
        return result;
    }, [files, searchQuery, tombstones, currentDir]);
    const filteredAssets = useMemo(() => assets.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase()) && !tombstones.has(a.path)), [assets, searchQuery, tombstones]);
    const filteredDrafts = useMemo(() => localDrafts.filter(d =>
        (d.title.toLowerCase().includes(searchQuery.toLowerCase()) || d.content.toLowerCase().includes(searchQuery.toLowerCase())) &&
        d.repoPath === repoPath
    ), [localDrafts, searchQuery, repoPath]);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header elevated={false} style={{ backgroundColor: theme.colors.background }}>
                <Appbar.Content title="Dashboard" titleStyle={{ fontWeight: 'bold' }} />
                <Button
                    icon="source-repository"
                    mode="text"
                    compact
                    onPress={() => router.replace('/')}
                >
                    Repos
                </Button>
                <Button
                    icon="cog-outline"
                    mode="text"
                    compact
                    onPress={() => router.push('/config?from=dashboard')}
                    style={{ marginRight: 12 }}
                >
                    Settings
                </Button>
            </Appbar.Header>

            <View style={styles.tabContainer}>
                <SegmentedButtons
                    value={mode}
                    onValueChange={(val: any) => { setMode(val); setSearchQuery(''); setCurrentDir(''); }}
                    buttons={segmentedButtons}
                    style={{ marginHorizontal: 16, marginBottom: 8 }}
                />
            </View>

            <View style={styles.searchContainer}>
                <Searchbar
                    placeholder={`Search ${mode}...`}
                    onChangeText={setSearchQuery}
                    value={searchQuery}
                    style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
                    inputStyle={styles.searchbarInput}
                    elevation={0}
                />
            </View>

            <View style={styles.content}>
                {isInitialLoading ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="large" color={theme.colors.primary} />
                    </View>
                ) : (
                    <SlidingTabContainer selectedIndex={selectedIndex}>
                        {/* Posts Tab */}
                        <View style={{ flex: 1 }}>
                            <FlatList
                                data={filteredFiles}
                                keyExtractor={postKeyExtractor}
                                contentContainerStyle={styles.draftList}
                                refreshControl={
                                    <RefreshControl
                                        refreshing={isLoading && mode === 'posts'}
                                        onRefresh={handleRefreshPosts}
                                        colors={[theme.colors.primary]}
                                        progressBackgroundColor={theme.colors.surface}
                                    />
                                }
                                renderItem={renderPostItem}
                                ListEmptyComponent={hasLoadedPosts ? (<View style={styles.emptyState}><Avatar.Icon size={64} icon="file-search-outline" style={{ backgroundColor: 'transparent' }} color={theme.colors.outline} /><Text variant="bodyLarge" style={{ color: theme.colors.outline, marginTop: 16 }}>No posts found.</Text></View>) : null}
                            />
                        </View>

                        {/* Drafts Tab */}
                        <View style={{ flex: 1 }}>
                            <FlatList
                                data={filteredDrafts}
                                keyExtractor={draftKeyExtractor}
                                contentContainerStyle={styles.draftList}
                                renderItem={renderDraftItem}
                                ListEmptyComponent={<View style={styles.emptyState}><Avatar.Icon size={64} icon="pencil-outline" style={{ backgroundColor: 'transparent' }} color={theme.colors.outline} /><Text variant="bodyLarge" style={{ color: theme.colors.outline, marginTop: 16 }}>No drafts yet.</Text></View>}
                            />
                        </View>

                        {/* Assets Tab */}
                        <View style={{ flex: 1 }}>
                            <FlatList
                                data={filteredAssets}
                                keyExtractor={assetKeyExtractor}
                                numColumns={2}
                                columnWrapperStyle={styles.assetRow}
                                contentContainerStyle={styles.assetList}
                                refreshControl={
                                    <RefreshControl
                                        refreshing={isLoading && mode === 'assets'}
                                        onRefresh={handleRefreshAssets}
                                        colors={[theme.colors.primary]}
                                        progressBackgroundColor={theme.colors.surface}
                                    />
                                }
                                renderItem={renderAssetItem}
                                ListEmptyComponent={hasLoadedAssets ? (<View style={styles.emptyState}><Avatar.Icon size={64} icon="image-off-outline" style={{ backgroundColor: 'transparent' }} color={theme.colors.outline} /><Text variant="bodyLarge" style={{ color: theme.colors.outline, marginTop: 16 }}>No assets found.</Text></View>) : null}
                            />
                        </View>
                    </SlidingTabContainer>
                )}
            </View>

            <Portal>
                <NewFileDialog
                    visible={isNewFileVisible}
                    onDismiss={() => setIsNewFileVisible(false)}
                    onCreate={handleCreateFile}
                    title="New Post"
                    label="Filename"
                />

                <NewFileDialog
                    visible={isNewDraftVisible}
                    onDismiss={() => setIsNewDraftVisible(false)}
                    onCreate={handleCreateDraft}
                    title="New Draft"
                    label="Draft Title"
                />

                <ImageNameDialog
                    visible={isImageNameVisible}
                    onDismiss={() => setIsImageNameVisible(false)}
                    onConfirm={confirmUpload}
                    initialValue={''}
                />

                <RenameDialog
                    visible={isRenameVisible}
                    onDismiss={() => setIsRenameVisible(false)}
                    onRename={mode === 'assets' ? handleRenameAsset : handleRenameFile}
                    initialValue={mode === 'assets' ? (selectedAsset?.name?.split('.')[0] || '') : (selectedFile?.name?.replace('.md', '') || '')}
                />

                <RenameDialog
                    visible={isRenameDraftVisible}
                    onDismiss={() => setIsRenameDraftVisible(false)}
                    onRename={handleRenameDraft}
                    initialValue={selectedDraft?.title || ''}
                    title="Rename Draft"
                    label="Draft Title"
                />

                <Dialog visible={isDeleteVisible} onDismiss={() => setIsDeleteVisible(false)} style={{ borderRadius: 28 }}>
                    <Dialog.Title>Delete {mode === 'assets' ? 'Asset' : 'Post'}</Dialog.Title>
                    <Dialog.Content>
                        <Text>Are you sure you want to delete '{mode === 'assets' ? selectedAsset?.name : selectedFile?.name}'?</Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setIsDeleteVisible(false)}>Cancel</Button>
                        <Button onPress={mode === 'assets' ? handleDeleteAsset : handleDeleteFile} textColor={theme.colors.error}>Delete</Button>
                    </Dialog.Actions>
                </Dialog>
                <Dialog visible={isDeleteDraftVisible} onDismiss={() => setIsDeleteDraftVisible(false)} style={{ borderRadius: 28 }}>
                    <Dialog.Title>Delete Draft</Dialog.Title>
                    <Dialog.Content>
                        <Text>Are you sure you want to delete '{selectedDraft?.title}'?</Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setIsDeleteDraftVisible(false)}>Cancel</Button>
                        <Button
                            onPress={async () => {
                                if (selectedDraft) await deleteDraft(selectedDraft.id);
                                setIsDeleteDraftVisible(false);
                                setSelectedDraft(null);
                            }}
                            textColor={theme.colors.error}
                        >
                            Delete
                        </Button>
                    </Dialog.Actions>
                </Dialog>

                <PublishDraftDialog
                    visible={isPublishDialogVisible}
                    onDismiss={() => setIsPublishDialogVisible(false)}
                    initialTitle={selectedDraft?.title || ''}
                    onPublish={handlePublishDraft}
                />
            </Portal>

            <Snackbar
                visible={snackbarVisible}
                onDismiss={() => setSnackbarVisible(false)}
                duration={3000}
                style={{ backgroundColor: theme.colors.secondaryContainer, borderRadius: 12 }}
            >
                <Text style={{ color: theme.colors.onSecondaryContainer }}>{snackbarMsg}</Text>
            </Snackbar>

            <FAB
                icon={mode === 'assets' ? 'upload' : 'plus'}
                label={mode === 'posts' ? 'New Post' : mode === 'drafts' ? 'New Draft' : 'Upload Image'}
                style={styles.fab}
                onPress={handleAction}
            />
        </View >
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { flex: 1 },
    searchContainer: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 16,
    },
    searchbar: {
        borderRadius: 28,
        backgroundColor: 'rgba(0,0,0,0.03)',
        height: 52,
        elevation: 0,
    },
    searchbarInput: {
        minHeight: 0,
        alignSelf: 'center',
    },
    dialogInput: {
        backgroundColor: 'rgba(0,0,0,0.03)',
        marginTop: 8,
    },
    swipeableContainer: {
        overflow: 'visible',
    },
    ripple: {
        overflow: 'hidden',
    },
    listItemWrapper: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(0,0,0,0.08)',
    },
    listItem: {
        paddingVertical: 18,
        paddingHorizontal: 12,
    },
    listItemTitle: { fontSize: 17, fontWeight: '600' },
    listItemSubtitle: { fontSize: 13, opacity: 0.6, marginTop: 2 },
    emptyState: { flex: 1, padding: 64, alignItems: 'center', justifyContent: 'center' },
    fab: {
        position: 'absolute',
        margin: 16,
        right: 16,
        bottom: 16,
        borderRadius: 16,
        paddingHorizontal: 8,
        elevation: 4,
    },
    tabContainer: {
        paddingBottom: 8,
    },
    assetList: {
        padding: 8,
        paddingBottom: 100,
    },
    assetRow: {
        justifyContent: 'space-between',
        paddingHorizontal: 8,
    },
    assetCard: {
        width: ASSET_ITEM_SIZE,
        margin: 8,
        borderRadius: 16,
        overflow: 'hidden',
        elevation: 2,
    },
    assetThumbContainer: { position: 'relative' },
    assetImage: { width: '100%', aspectRatio: 1 },
    assetOverlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        flexDirection: 'row',
        padding: 2
    },
    assetName: { fontSize: 11, fontWeight: '500', textAlign: 'center' },
    draftList: {
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 100,
    },
    draftCardWrapper: {
        marginBottom: 12,
        borderRadius: 16,
    },
    draftCard: {
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
    },
    draftHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    draftTitle: {
        flex: 1,
        fontWeight: 'bold',
    },
    draftSnippet: {
        opacity: 0.7,
        marginBottom: 8,
        lineHeight: 18,
    },
    draftDate: {
        opacity: 0.5,
    },
    rightActionContainer: { width: 100, paddingVertical: 8, paddingRight: 12 },
    leftActionContainer: { width: 100, paddingVertical: 8, paddingLeft: 12 },
    actionButton: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 50,
        elevation: 2,
    }
});
