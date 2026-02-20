import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Buffer } from 'buffer';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Dimensions, FlatList, Keyboard, KeyboardAvoidingView, TextInput as NativeTextInput, Platform, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { default as Markdown } from 'react-native-markdown-display';
import { Appbar, Button, Dialog, IconButton, Text as PaperText, Portal, SegmentedButtons, Snackbar, TextInput, useTheme } from 'react-native-paper';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useAppContext } from '../../context/AppContext';

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 2;
const ITEM_SIZE = (width - 32) / COLUMN_COUNT; // Slightly smaller since it's within a tab

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


// Sub-component for Image Naming Dialog
const ImageNameDialog = ({ visible, onDismiss, onConfirm, initialValue }: { visible: boolean, onDismiss: () => void, onConfirm: (val: string) => void, initialValue: string }) => {
    const [localValue, setLocalValue] = useState(initialValue);
    useEffect(() => { if (visible) setLocalValue(initialValue); }, [visible, initialValue]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss}>
            <Dialog.Title>Name your image</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    label="Filename"
                    value={localValue}
                    onChangeText={setLocalValue}
                    mode="flat"
                    autoFocus
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button onPress={() => onConfirm(localValue)}>Add to Post</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

// Sub-component for Commit Message Dialog
const CommitDialog = ({ visible, onDismiss, onPublish, initialMsg, isDraft, initialFilename }: { visible: boolean, onDismiss: () => void, onPublish: (msg: string) => void, initialMsg: string, isDraft: boolean, initialFilename: string }) => {
    const [localMsg, setLocalMsg] = useState(initialMsg);
    const theme = useTheme();

    useEffect(() => {
        if (visible) {
            setLocalMsg(initialMsg);
        }
    }, [visible, initialMsg]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>Publish to GitHub</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    label="Commit Message"
                    value={localMsg}
                    onChangeText={setLocalMsg}
                    mode="flat"
                    style={{ marginBottom: 8 }}
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button mode="contained" onPress={() => onPublish(localMsg)} style={{ borderRadius: 20 }}>Push</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

// Stabilize image rendering in Markdown preview
const MemoizedMarkdownImage = React.memo(({ uri, headers, alt, theme }: any) => {
    return (
        <View style={{ marginVertical: 16, alignItems: 'center', width: '100%' }}>
            <Image
                source={{ uri, headers }}
                style={{
                    width: Dimensions.get('window').width - 48,
                    height: 250,
                    borderRadius: 16,
                    backgroundColor: theme.colors.surfaceVariant,
                    borderWidth: 1,
                    borderColor: theme.colors.outlineVariant
                }}
                contentFit="contain"
                cachePolicy="disk"
            />
            {alt ? (
                <PaperText style={{ color: theme.colors.onSurfaceVariant, fontSize: 13, marginTop: 8, fontStyle: 'italic' }}>
                    {alt}
                </PaperText>
            ) : null}
        </View>
    );
}, (prev, next) => {
    return prev.uri === next.uri &&
        prev.alt === next.alt &&
        prev.theme.colors.surfaceVariant === next.theme.colors.surfaceVariant &&
        JSON.stringify(prev.headers) === JSON.stringify(next.headers);
});

// Sub-component for Assets Manager
const AssetsManager = ({ repoPath, staticDir, assetsDir, onInsert }: { repoPath: string | null, staticDir: string, assetsDir: string, onInsert: (filename: string) => void }) => {
    const { config, assetCache, setRepoAssetCache } = useAppContext();
    const [isLoading, setIsLoading] = useState(false);
    const [githubToken, setGithubToken] = useState<string | null>(null);
    const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
    const [renameVisible, setRenameVisible] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState<any>(null);
    const theme = useTheme();

    const repoConfig = repoPath ? config.repoConfigs[repoPath] : null;
    const [fetchError, setFetchError] = useState<string | null>(null);
    const assets = repoPath ? (assetCache[repoPath] || []) : [];

    useEffect(() => {
        SecureStore.getItemAsync('github_access_token').then(setGithubToken);
    }, []);

    const fetchAssets = useCallback(async (silent = false) => {
        if (!repoPath) return;
        if (!silent && assets.length === 0) setIsLoading(true);
        setFetchError(null);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const cleanStatic = staticDir.replace(/^\/+|\/+$/g, '');
            const cleanAssets = assetsDir.replace(/^\/+|\/+$/g, '');
            const fullPath = [cleanStatic, cleanAssets].filter(Boolean).join('/');

            const response = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${fullPath}`, {
                headers: {
                    Authorization: `token ${token}`,
                    'Cache-Control': 'no-cache'
                }
            });

            if (!Array.isArray(response.data)) {
                throw new Error('Path is not a directory');
            }

            const imageFiles = response.data.filter((f: any) =>
                f.type === 'file' && f.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)
            );
            await setRepoAssetCache(repoPath, imageFiles);
        } catch (e: any) {
            console.error('[Assets] Fetch failed', e.message);
            setFetchError(e.response?.status === 404 ? 'Directory not found' : (e.message || 'Fetch failed'));
        } finally {
            setIsLoading(false);
        }
    }, [repoPath, staticDir, assetsDir, setRepoAssetCache]);

    useEffect(() => {
        if (repoPath) {
            // Clear current view if repo/path changes radically
            setRepoAssetCache(repoPath, []);
            fetchAssets();
        }
    }, [repoPath, staticDir, assetsDir]);

    const handleDelete = async () => {
        if (!repoPath || !selectedAsset) return;
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedAsset.path}`, {
                headers: { Authorization: `token ${token}` },
                data: {
                    message: `Delete asset ${selectedAsset.name}`,
                    sha: selectedAsset.sha
                }
            });
            const updatedAssets = assets.filter(a => a.path !== selectedAsset.path);
            await setRepoAssetCache(repoPath, updatedAssets);
        } catch (e: any) {
            console.error('[Assets] Delete failed', e.response?.data || e.message);
        } finally {
            setDeleteConfirmVisible(false);
            setSelectedAsset(null);
        }
    };

    const handleRename = async (newName: string) => {
        if (!selectedAsset || !newName || !repoPath || !repoConfig) return;
        const ext = selectedAsset.name.split('.').pop();
        const cleanName = newName.includes('.') ? newName : `${newName}.${ext}`;
        const fullAssetsPath = [staticDir, assetsDir].filter(Boolean).join('/');
        const newPath = `${fullAssetsPath}/${cleanName}`.replace(/^\/+/, '').replace(/\/+/g, '/');

        setIsLoading(true);
        setRenameVisible(false);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const contentResponse = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${selectedAsset.path}`, {
                headers: { Authorization: `token ${token}` }
            });
            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, {
                message: `Rename ${selectedAsset.name} to ${cleanName}`,
                content: contentResponse.data.content,
            }, {
                headers: { Authorization: `token ${token}` }
            });
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedAsset.path}`, {
                headers: { Authorization: `token ${token}` },
                data: {
                    message: `Cleanup after rename ${selectedAsset.name} to ${cleanName}`,
                    sha: selectedAsset.sha
                }
            });
            const updatedAssets = assets.map(a => a.path === selectedAsset.path ? { ...a, name: cleanName, path: newPath } : a);
            await setRepoAssetCache(repoPath, updatedAssets);
        } catch (e: any) {
            console.error('[Assets] Rename failed', e.response?.data || e.message);
        } finally {
            setIsLoading(false);
            setSelectedAsset(null);
        }
    };

    if (isLoading && assets.length === 0) {
        return <View style={{ flex: 1 }} />;
    }

    if (fetchError || assets.length === 0) {
        return (
            <View style={styles.center}>
                <PaperText style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                    {fetchError || `No images found in ${[staticDir, assetsDir].filter(Boolean).join('/') || 'root'}`}
                </PaperText>
                <Button mode="text" onPress={() => fetchAssets()} icon="refresh">Refresh</Button>
            </View>
        );
    }

    const headers = githubToken ? { Authorization: `token ${githubToken}` } : undefined;

    return (
        <View style={{ flex: 1 }}>
            <FlatList
                data={assets}
                keyExtractor={(item) => item.path}
                numColumns={COLUMN_COUNT}
                contentContainerStyle={styles.assetsGrid}
                refreshControl={
                    <RefreshControl
                        refreshing={isLoading}
                        onRefresh={() => fetchAssets()}
                        colors={[theme.colors.primary]}
                        progressBackgroundColor={theme.colors.surface}
                    />
                }
                renderItem={({ item }) => (
                    <View style={[styles.assetCard, { backgroundColor: theme.colors.surfaceVariant, opacity: item.isPending ? 0.6 : 1 }]}>
                        <TouchableOpacity onPress={() => onInsert(item.name)} style={styles.assetThumbContainer}>
                            <Image
                                source={{ uri: item.download_url, headers }}
                                style={styles.assetImage}
                                contentFit="cover"
                                cachePolicy="disk"
                            />
                            <View style={styles.assetOverlay}>
                                <IconButton
                                    icon="cursor-text"
                                    iconColor="white"
                                    size={20}
                                    onPress={() => {
                                        setSelectedAsset(item);
                                        setRenameVisible(true);
                                    }}
                                    style={{ backgroundColor: 'rgba(0,0,0,0.3)', margin: 2 }}
                                />
                                <IconButton
                                    icon="delete"
                                    iconColor={theme.colors.error}
                                    size={20}
                                    onPress={() => {
                                        setSelectedAsset(item);
                                        setDeleteConfirmVisible(true);
                                    }}
                                    style={{ backgroundColor: 'rgba(0,0,0,0.3)', margin: 2 }}
                                />
                            </View>
                        </TouchableOpacity>
                        <View style={{ backgroundColor: theme.colors.surface, padding: 4 }}>
                            <PaperText variant="bodySmall" numberOfLines={1} style={styles.assetCardName}>{item.name}</PaperText>
                        </View>
                    </View>
                )}
            />

            <Portal>
                <Dialog visible={renameVisible} onDismiss={() => setRenameVisible(false)}>
                    <Dialog.Title>Rename Asset</Dialog.Title>
                    <Dialog.Content>
                        <TextInput
                            label="New Name"
                            defaultValue={selectedAsset?.name.split('.')[0]}
                            onSubmitEditing={(e) => handleRename(e.nativeEvent.text)}
                            mode="outlined"
                            autoFocus
                        />
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setRenameVisible(false)}>Cancel</Button>
                    </Dialog.Actions>
                </Dialog>

                <Dialog visible={deleteConfirmVisible} onDismiss={() => setDeleteConfirmVisible(false)} style={{ borderRadius: 28 }}>
                    <Dialog.Title>Delete Asset?</Dialog.Title>
                    <Dialog.Content>
                        <PaperText variant="bodyMedium">Are you sure you want to delete '{selectedAsset?.name}'? This cannot be undone and may break existing posts.</PaperText>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setDeleteConfirmVisible(false)}>Cancel</Button>
                        <Button onPress={handleDelete} textColor={theme.colors.error}>Delete</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </View>
    );
};


export default function Editor() {
    const { path, new: isNewParam, title: titleParam } = useLocalSearchParams();
    const isNew = isNewParam === 'true';
    const decodedPath = decodeURIComponent(path as string);
    const isLocalDraft = decodedPath.startsWith('draft_');
    const draftId = isLocalDraft ? decodedPath.replace('draft_', '') : null;

    const { config, localDrafts, saveDraft, deleteDraft, setRepoAssetCache, assetCache } = useAppContext();
    const theme = useTheme();
    const router = useRouter();

    const repoPath = config.repo;
    const repoConfig = repoPath ? config.repoConfigs[repoPath] : null;

    const [content, setContent] = useState('');
    const [title, setTitle] = useState((titleParam as string) || decodedPath.split('/').pop()?.replace('.md', '') || '');
    const [isLoading, setIsLoading] = useState(!isNew);
    const [isSaving, setIsSaving] = useState(false);
    const [sha, setSha] = useState<string | null>(null);
    const [selection, setSelection] = useState({ start: 0, end: 0 });

    // Mode: 'edit' | 'preview' | 'assets'
    const [mode, setMode] = useState('edit');
    const editorSelectedIndex = ['edit', 'preview', 'assets'].indexOf(mode);

    // Snapshot content for preview to avoid re-renders on every keystroke
    const [previewContent, setPreviewContent] = useState('');

    // Asset Staging
    // const [pendingAssets, setPendingAssets] = useState<{ [filename: string]: string }>({}); // Removed pending, we upload immediately
    const [lastPickedUri, setLastPickedUri] = useState<string | null>(null);
    const [pickedFilename, setPickedFilename] = useState('');
    const [isImageNameVisible, setIsImageNameVisible] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    // Commit UI states
    const [isCommitModalVisible, setIsCommitModalVisible] = useState(false);

    const [snackbarVisible, setSnackbarVisible] = useState(false);
    const [snackbarMsg, setSnackbarMsg] = useState('');
    const [githubToken, setGithubToken] = useState<string | null>(null);

    const inputRef = useRef<NativeTextInput>(null);
    const AUTOSAVE_KEY = `flux_draft_${decodedPath}`;

    // Load Token for Image Rendering
    useEffect(() => {
        SecureStore.getItemAsync('github_access_token').then(setGithubToken);
    }, []);

    const markdownStyle = useMemo(() => StyleSheet.create({
        body: {
            color: theme.colors.onSurface,
            fontSize: 16,
            lineHeight: 26,
            fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }),
        },
        heading1: {
            fontSize: 34,
            fontWeight: '900',
            color: theme.colors.primary,
            marginBottom: 20,
            marginTop: 30,
            lineHeight: 42,
            letterSpacing: -0.5,
        },
        heading2: {
            fontSize: 28,
            fontWeight: '800',
            color: theme.colors.primary,
            marginBottom: 16,
            marginTop: 24,
            lineHeight: 36,
            letterSpacing: -0.3,
        },
        heading3: {
            fontSize: 22,
            fontWeight: '700',
            color: theme.colors.primary,
            marginBottom: 12,
            marginTop: 20,
            lineHeight: 30,
        },
        link: {
            color: theme.colors.primary,
            textDecorationLine: 'underline',
            fontWeight: '600',
        },
        blockquote: {
            borderColor: theme.colors.primary,
            borderLeftWidth: 6,
            marginLeft: 0,
            paddingLeft: 16,
            paddingVertical: 8,
            backgroundColor: theme.colors.surfaceVariant + '40',
            color: theme.colors.onSurfaceVariant,
            fontStyle: 'italic',
            borderRadius: 4,
        },
        code_block: {
            fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
            backgroundColor: theme.colors.surfaceVariant,
            color: theme.colors.onSurfaceVariant,
            padding: 16,
            borderRadius: 12,
            fontSize: 14,
            marginVertical: 12,
            borderWidth: 1,
            borderColor: theme.colors.outlineVariant,
        },
        code_inline: {
            fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
            backgroundColor: theme.colors.surfaceVariant,
            color: theme.colors.primary,
            borderRadius: 4,
            paddingHorizontal: 4,
            fontSize: 14,
        },
        strong: {
            fontWeight: 'bold',
            color: theme.colors.onSurface,
        },
        em: {
            fontStyle: 'italic',
        },
        hr: {
            backgroundColor: theme.colors.outlineVariant,
            height: 1,
            marginVertical: 24,
        },
        list_item: {
            marginVertical: 4,
        },
    }), [theme]);

    // Stabilize headers for image rendering to prevent refetches
    const imageHeaders = useMemo(() => githubToken ? {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3.raw',
    } : undefined, [githubToken]);

    // Custom Render Rules to fix Image "key" crash and handle Auth
    const renderRules = useMemo(() => ({
        image: (node: any, children: any, parent: any, styles: any) => {
            const { src, alt } = node.attributes;
            let uri = src;

            if (repoPath && repoConfig && !src.startsWith('http')) {
                const cleanSrc = src.replace(/^\/+/, '');
                // If it's a relative path to assets, prepend staticDir
                const assetsPath = repoConfig.assetsDir.replace(/^\/+|\/+$/g, '');
                const staticPath = repoConfig.staticDir.replace(/^\/+|\/+$/g, '');

                let targetPath = cleanSrc;
                if (!cleanSrc.includes('/')) {
                    // Simple filename, use configured paths
                    targetPath = [staticPath, assetsPath, cleanSrc].filter(Boolean).join('/');
                } else {
                    // It has a path. Check if it's already the full path or relative to assets
                    const parts = cleanSrc.split('/');
                    const firstPart = parts[0];
                    const assetsParts = assetsPath.split('/').filter(Boolean);
                    const firstAssetsPart = assetsParts[0];

                    if (firstAssetsPart && firstPart === firstAssetsPart) {
                        // Link is like /assets/img.png. Prepend staticDir if needed.
                        targetPath = [staticPath, cleanSrc].filter(Boolean).join('/');
                    }
                    // If it already starts with staticPath, it's a full path, keep it.
                }

                uri = `https://api.github.com/repos/${repoPath}/contents/${targetPath.replace(/\/+/g, '/')}`;
            }

            return (
                <MemoizedMarkdownImage
                    key={node.key}
                    uri={uri}
                    headers={imageHeaders}
                    alt={alt}
                    theme={theme}
                />
            );
        },
        softbreak: (node: any, children: any, parent: any, styles: any) => {
            return <PaperText key={node.key}> </PaperText>;
        },
    }), [repoPath, repoConfig, imageHeaders, theme]);


    const fetchFile = async () => {
        if (isLocalDraft && draftId) {
            const draft = localDrafts.find(d => d.id === draftId);
            if (draft) {
                setContent(draft.content);
                setTitle(draft.title);
            }
            setIsLoading(false);
            return;
        }

        if (!repoPath) return;

        if (isNew) {
            const draft = await AsyncStorage.getItem(AUTOSAVE_KEY);
            if (draft) {
                setContent(draft);
            } else {
                let template = repoConfig?.postTemplate || "---\ntitle: {{title}}\ndate: {{date}}\ndraft: true\n---\n\n";
                const date = new Date().toISOString().split('T')[0];
                const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
                template = template.replace(/{{title}}/g, title)
                    .replace(/{{date}}/g, date)
                    .replace(/{{time}}/g, time);
                setContent(template);
            }
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const response = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${decodedPath}`, {
                headers: {
                    Authorization: `token ${token}`,
                    'Cache-Control': 'no-cache'
                }
            });
            const rawContent = Buffer.from(response.data.content, 'base64').toString('utf8');
            const draft = await AsyncStorage.getItem(AUTOSAVE_KEY);
            setContent(draft || rawContent);
            setSha(response.data.sha);
        } catch (e) {
            console.error('[Editor] Fetch failed', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchFile();
    }, [path]);

    useEffect(() => {
        if (!content || isLoading) return;
        const timer = setTimeout(async () => {
            await AsyncStorage.setItem(AUTOSAVE_KEY, content);
        }, 2000);
        return () => clearTimeout(timer);
    }, [content]);

    const handlePublish = async (msg: string) => {
        if (!repoPath || !repoConfig) return;

        let cleanPostPath = decodedPath.replace(/^\/+/, '').replace(/\/+/g, '/');
        if (isLocalDraft) {
            // Use draft title normalized as filename
            const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const extFilename = `${normalized}.md`;
            cleanPostPath = `${repoConfig.contentDir}/${extFilename}`.replace(/^\/+/, '').replace(/\/+/g, '/');
        }

        setIsCommitModalVisible(false);
        setIsSaving(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            if (!token) throw new Error('Not authenticated');

            const cleanAssetsDir = repoConfig.assetsDir.replace(/^\/+/, '').replace(/\/+/g, '/');

            // Upload pending assets first - REMOVED (Handled in confirmImage now)
            // for (const [filename, localUri] of Object.entries(pendingAssets)) { ... }

            let currentSha = sha;
            try {
                const checkResponse = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${cleanPostPath}`, {
                    headers: {
                        Authorization: `token ${token}`,
                        'Cache-Control': 'no-cache'
                    }
                });
                currentSha = checkResponse.data.sha;
                setSha(currentSha);
            } catch (e: any) {
                if (e.response?.status !== 404) throw e;
            }

            const payload = {
                message: msg || (isNew ? `Create ${title}` : `Update ${title}`),
                content: Buffer.from(content).toString('base64'),
                sha: currentSha || undefined
            };

            const saveResponse = await axios.put(`https://api.github.com/repos/${repoPath}/contents/${cleanPostPath}`, payload, {
                headers: { Authorization: `token ${token}` }
            });

            setSha(saveResponse.data.content.sha);
            setSha(saveResponse.data.content.sha);
            // setPendingAssets({}); // No longer used
            await AsyncStorage.removeItem(AUTOSAVE_KEY);
            if (isLocalDraft && draftId) {
                await deleteDraft(draftId);
            }
            setSnackbarMsg('Published to GitHub');
            setSnackbarVisible(true);

            // Redirect to the new post URL if it was a draft
            if (isLocalDraft) {
                router.replace(`/editor/${encodeURIComponent(cleanPostPath)}`);
            }
        } catch (e: any) {
            console.error('[Editor] Save failed', e);
            const githubError = e.response?.data?.message || e.message || 'Unknown error';
            setSnackbarMsg(`Save failed: ${githubError}`);
            setSnackbarVisible(true);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveLocal = async (shouldRedirect = true) => {
        setIsSaving(true);
        try {
            const id = draftId || Date.now().toString();
            // Use existing title state or fallback
            let calculatedTitle = title || 'Untitled Draft';

            await saveDraft({
                id,
                title: calculatedTitle || 'Untitled Draft',
                content,
                lastModified: new Date().toISOString(),
                repoPath: repoPath || ''
            });

            setSnackbarMsg('Draft saved locally');
            setSnackbarVisible(true);

            // If it was a new post being saved as draft, redirect unless suppressing
            if (!isLocalDraft && shouldRedirect) {
                router.replace(`/editor/draft_${id}`);
            }
        } catch (e: any) {
            setSnackbarMsg(`Draft save failed: ${e.message}`);
            setSnackbarVisible(true);
        } finally {
            setIsSaving(false);
        }
    };

    const pickImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            quality: 0.8,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const asset = result.assets[0];
            const resized = await ImageManipulator.manipulateAsync(
                asset.uri,
                [{ resize: { width: 1200 } }],
                { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
            );
            setLastPickedUri(resized.uri);
            // Start with blank filename so user can type directly
            setPickedFilename('');
            setIsImageNameVisible(true);
        }
    };

    const confirmImage = async (name: string) => {
        if (!lastPickedUri || !name || !repoConfig || !repoPath) return;

        setIsImageNameVisible(false); // Close dialog first
        setIsUploading(true);
        setSnackbarMsg('Uploading image...');
        setSnackbarVisible(true);

        const finalName = name.includes('.') ? name : `${name}.jpg`;
        const assetsPath = repoConfig.assetsDir.replace(/^\/+|\/+$/g, '');
        const staticPath = repoConfig.staticDir.replace(/^\/+|\/+$/g, '');

        const relativePath = `/${[assetsPath, finalName].filter(Boolean).join('/')}`;
        const assetPath = [staticPath, assetsPath, finalName].filter(Boolean).join('/');

        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            if (!token) throw new Error('Not authenticated');

            const response = await fetch(lastPickedUri);
            const blob = await response.blob();
            const reader = new FileReader();
            const base64Data = await new Promise<string>((resolve) => {
                reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                reader.readAsDataURL(blob);
            });

            // Check if exists to get SHA (for overwrite)
            let assetSha = undefined;
            try {
                const assetCheck = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${assetPath}`, {
                    headers: {
                        Authorization: `token ${token}`,
                        'Cache-Control': 'no-cache'
                    }
                });
                assetSha = assetCheck.data.sha;
            } catch (e: any) {
                if (e.response?.status !== 404) console.warn('Asset check failed', e);
            }

            // Upload
            const uploadRes = await axios.put(`https://api.github.com/repos/${repoPath}/contents/${assetPath}`, {
                message: `Upload ${finalName}`,
                content: base64Data,
                sha: assetSha
            }, {
                headers: { Authorization: `token ${token}` }
            });

            // Update Cache
            // We use setRepoAssetCache from component scope (captured from line 332)
            // const { setRepoAssetCache, assetCache } = useAppContext(); // REMOVED
            // We can acccess setRepoAssetCache from context hook

            // Re-fetch assets or update manually?
            // Let's just create the object roughly matching GitHub API
            const newAsset = {
                name: finalName,
                path: assetPath,
                sha: uploadRes.data.content.sha,
                size: uploadRes.data.content.size,
                url: uploadRes.data.content.url,
                html_url: uploadRes.data.content.html_url,
                git_url: uploadRes.data.content.git_url,
                download_url: uploadRes.data.content.download_url,
                type: 'file',
                _links: uploadRes.data.content._links
            };

            // This update might be tricky if we don't have the current list handy from context...
            // But we do: assetCache[repoPath] might exist in AppContext?
            // Actually, we are inside component. We have assetCache in context?
            // Yes, let's check useAppContext usage at top.

            // const { config, localDrafts, saveDraft, deleteDraft } = useAppContext(); -> Need to destructure assetCache there.

            // Insert Markdown
            const newContent = content.substring(0, selection.start) + `![${finalName}](${relativePath})` + content.substring(selection.end);
            setContent(newContent);
            setSnackbarMsg('Image uploaded and inserted');
            setLastPickedUri(null);

        } catch (e: any) {
            console.error('Upload failed', e);
            setSnackbarMsg(`Upload failed: ${e.message}`);
        } finally {
            setIsUploading(false);
            setSnackbarVisible(true);
        }
    };

    const handleInsertAsset = (filename: string) => {
        if (!repoConfig) return;
        const assetsPath = repoConfig.assetsDir.replace(/^\/+|\/+$/g, '');
        const relativePath = `/${[assetsPath, filename].filter(Boolean).join('/')}`;
        const newContent = content.substring(0, selection.start) + `![${filename}](${relativePath})` + content.substring(selection.end);
        setContent(newContent);
        setMode('edit');
    };

    const handleBack = useCallback(async () => {
        // Auto-save ONLY if it's a draft
        if (isLocalDraft) {
            await handleSaveLocal(false);
            // Wait for snackbar to be visible
            await new Promise(resolve => setTimeout(resolve, 800));
        }
        router.back();
    }, [isLocalDraft, handleSaveLocal, router]);

    // Handle System Back Button
    useEffect(() => {
        const onBackPress = () => {
            handleBack();
            return true;
        };

        const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
        return () => subscription.remove();
    }, [handleBack]);

    const handleDiscard = async () => {
        // Clear autosave
        await AsyncStorage.removeItem(AUTOSAVE_KEY);
        // Just go back without saving
        router.back();
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.container, { backgroundColor: theme.colors.background }]}
        >
            <Appbar.Header elevated={false} style={{ backgroundColor: theme.colors.background }}>
                <Appbar.BackAction onPress={handleBack} />
                <Appbar.Content
                    title={(title ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : (isLocalDraft ? 'untitled-draft' : 'new-post')) + '.md'}
                    titleStyle={styles.appbarTitle}
                />
                {(isLocalDraft || isNew) && (
                    <Button
                        icon="delete-outline"
                        mode="text"
                        onPress={handleDiscard}
                        textColor={theme.colors.error}
                        compact
                    >
                        Discard
                    </Button>
                )}
                <Button
                    icon={isLocalDraft ? "content-save-outline" : "file-document-edit-outline"}
                    mode="text"
                    onPress={() => handleSaveLocal(true)}
                    disabled={isSaving || isLoading || isUploading}
                    compact
                    style={!isLocalDraft ? {} : { marginRight: 12 }}
                >
                    {isLocalDraft ? "Save" : "Draft"}
                </Button>
                {!isLocalDraft && (
                    <Button
                        icon="cloud-upload-outline"
                        mode="text"
                        onPress={() => setIsCommitModalVisible(true)}
                        disabled={isSaving || isLoading}
                        compact
                        style={{ marginRight: 12 }}
                    >
                        Publish
                    </Button>
                )}
            </Appbar.Header>

            <View style={styles.tabContainer}>
                <SegmentedButtons
                    value={mode}
                    onValueChange={(val: string) => {
                        if (val !== 'edit') Keyboard.dismiss();
                        if (val === 'preview') {
                            // Strip frontmatter (YAML or TOML) for preview
                            const clean = content.replace(/^---\s*[\s\S]*?\n---\s*\n?/, '').replace(/^\+\+\+\s*[\s\S]*?\n\+\+\+\s*\n?/, '');
                            setPreviewContent(clean);
                        }
                        setMode(val);
                    }}
                    buttons={[
                        { value: 'edit', label: 'Edit', icon: 'pencil' },
                        { value: 'preview', label: 'Preview', icon: 'eye' },
                        { value: 'assets', label: 'Assets', icon: 'image-multiple' },
                    ]}
                    style={{ marginHorizontal: 16, marginBottom: 8 }}
                />
            </View>

            <View style={styles.editorContainer}>
                <SlidingTabContainer selectedIndex={editorSelectedIndex}>
                    <View style={{ flex: 1 }}>
                        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
                            <NativeTextInput
                                ref={inputRef}
                                style={[styles.input, { color: theme.colors.onSurface, backgroundColor: theme.colors.background }]}
                                multiline
                                value={content}
                                onChangeText={setContent}
                                onSelectionChange={e => setSelection(e.nativeEvent.selection)}
                                placeholder="Write something beautiful..."
                                textAlignVertical="top"
                                scrollEnabled={false} // Le t the parent ScrollView handle scrolling
                            />
                        </ScrollView>
                        {/* Floating Action Button for adding images in Edit mode */}
                        <IconButton
                            icon="image-plus"
                            mode="contained"
                            size={28}
                            style={styles.fab}
                            onPress={pickImage}
                        />
                    </View>

                    {/* Preview Tab */}
                    <View style={{ flex: 1 }}>
                        <ScrollView style={styles.previewContainer} contentContainerStyle={{ paddingBottom: 100 }}>
                            <Markdown style={markdownStyle} rules={renderRules}>
                                {previewContent}
                            </Markdown>
                        </ScrollView>
                    </View>

                    {/* Assets Tab */}
                    <View style={{ flex: 1 }}>
                        <AssetsManager
                            repoPath={repoPath}
                            staticDir={repoConfig?.staticDir || ''}
                            assetsDir={repoConfig?.assetsDir || ''}
                            onInsert={handleInsertAsset}
                        />
                    </View>
                </SlidingTabContainer>
            </View>

            <Portal>
                <ImageNameDialog
                    visible={isImageNameVisible}
                    onDismiss={() => setIsImageNameVisible(false)}
                    onConfirm={confirmImage}
                    initialValue={pickedFilename}
                />

                <CommitDialog
                    visible={isCommitModalVisible}
                    onDismiss={() => setIsCommitModalVisible(false)}
                    onPublish={handlePublish}
                    initialMsg={isNew ? `Create ${title}` : `Update ${title}`}
                    isDraft={isLocalDraft}
                    initialFilename={title}
                />
            </Portal>

            <Snackbar
                visible={snackbarVisible}
                onDismiss={() => setSnackbarVisible(false)}
                duration={3000}
                style={{ backgroundColor: theme.colors.secondaryContainer, borderRadius: 12 }}
            >
                <PaperText style={{ color: theme.colors.onSecondaryContainer }}>{snackbarMsg}</PaperText>
            </Snackbar>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    appbarTitle: { fontSize: 18, fontWeight: 'bold', opacity: 0.8 },
    tabContainer: { paddingBottom: 8 },
    editorContainer: { flex: 1 },
    input: { minHeight: '100%', padding: 24, fontSize: 18, lineHeight: 28 },
    previewContainer: { flex: 1, padding: 24 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    assetsGrid: { padding: 4 },
    assetCard: { width: ITEM_SIZE, margin: 4, borderRadius: 12, overflow: 'hidden' },
    assetThumbContainer: { position: 'relative' },
    assetImage: { width: '100%', aspectRatio: 1 },
    assetOverlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        flexDirection: 'row',
        padding: 4
    },
    assetCardName: { fontSize: 11, padding: 4, textAlign: 'center' },
    fab: {
        position: 'absolute',
        margin: 16,
        right: 0,
        bottom: 0,
    },
});
