import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Buffer } from 'buffer';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Dimensions, FlatList, Keyboard, KeyboardAvoidingView, Linking, TextInput as NativeTextInput, Platform, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { default as Markdown } from 'react-native-markdown-display';
import { Appbar, Button, Dialog, IconButton, Text as PaperText, Portal, SegmentedButtons, Surface, TextInput, useTheme } from 'react-native-paper';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useAppContext } from '../../context/AppContext';

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 2;
const ASSET_SPACING = 12;
const ASSET_CONTAINER_PADDING = 16;
const ASSET_ITEM_WIDTH = (width - (ASSET_CONTAINER_PADDING * 2) - ASSET_SPACING) / COLUMN_COUNT;

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


const formatBytes = (bytes: number, decimals = 2) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// Sub-component for Image Naming Dialog
const ImageNameDialog = ({ visible, onDismiss, onConfirm, initialValue, extension, size }: { visible: boolean, onDismiss: () => void, onConfirm: (val: string) => void, initialValue: string, extension: string, size?: number }) => {
    const [localValue, setLocalValue] = useState(initialValue);

    useEffect(() => {
        if (visible) {
            setLocalValue(initialValue);
        }
    }, [visible, initialValue]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss}>
            <Dialog.Title>New Asset</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    label="Filename"
                    value={localValue}
                    onChangeText={setLocalValue}
                    mode="flat"
                    autoFocus
                    right={extension ? <TextInput.Affix text={'.' + extension} /> : null}
                />
                {size ? (
                    <PaperText variant="bodySmall" style={{ marginTop: 8, opacity: 0.6, textAlign: 'right' }}>
                        File size: {formatBytes(size)}
                    </PaperText>
                ) : null}
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button onPress={() => onConfirm(localValue)}>Add to Post</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

// Sub-component for Link/Mention Dialog
const LinkMentionDialog = ({ visible, onDismiss, onConfirm }: { visible: boolean, onDismiss: () => void, onConfirm: (url: string, text: string, type: string) => void }) => {
    const [url, setUrl] = useState('');
    const [text, setText] = useState('');
    const [type, setType] = useState('mention');

    useEffect(() => {
        if (visible) {
            const checkClipboard = async () => {
                try {
                    const hasString = await Clipboard.hasStringAsync();
                    if (hasString) {
                        const content = await Clipboard.getStringAsync();
                        if (content.match(/^https?:\/\//i)) {
                            setUrl(content);
                        } else {
                            setUrl('');
                        }
                    } else {
                        setUrl('');
                    }
                } catch (e) {
                    console.error('Clipboard check failed', e);
                    setUrl('');
                }
                setText('');
                setType('mention');
            };
            checkClipboard();
        }
    }, [visible]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>Add Link / Mention</Dialog.Title>
            <Dialog.Content>
                <SegmentedButtons
                    value={type}
                    onValueChange={setType}
                    buttons={[
                        { value: 'mention', label: 'Mention', icon: 'link' },
                        { value: 'like', label: 'Like', icon: 'heart-outline' },
                        { value: 'reply', label: 'Reply', icon: 'reply' },
                    ]}
                    style={{ marginBottom: 16 }}
                />
                <TextInput
                    label="URL"
                    value={url}
                    onChangeText={setUrl}
                    mode="outlined"
                    style={{ marginBottom: 12 }}
                    autoCapitalize="none"
                    keyboardType="url"
                />
                <TextInput
                    label="Display Text"
                    value={text}
                    onChangeText={setText}
                    mode="outlined"
                    placeholder="Optional for mentions"
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button mode="contained" onPress={() => onConfirm(url, text, type)} disabled={!url} style={{ borderRadius: 20 }}>Insert</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

// Sub-component for Asset Type Selection
const AssetTypeDialog = ({ visible, onDismiss, onSelect }: { visible: boolean, onDismiss: () => void, onSelect: (type: 'image' | 'video' | 'file') => void }) => {
    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>New Asset</Dialog.Title>
            <Dialog.Content>
                <PaperText variant="bodyMedium" style={{ marginBottom: 16 }}>Choose the type of asset you want to upload:</PaperText>
                <View style={{ gap: 8 }}>
                    <Button mode="outlined" icon="image" onPress={() => onSelect('image')} style={{ borderRadius: 12 }}>Image</Button>
                    <Button mode="outlined" icon="video" onPress={() => onSelect('video')} style={{ borderRadius: 12 }}>Video</Button>
                    <Button mode="outlined" icon="file" onPress={() => onSelect('file')} style={{ borderRadius: 12 }}>Other</Button>
                </View>
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
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
    const [aspectRatio, setAspectRatio] = useState<number | null>(null);

    return (
        <View style={{ marginVertical: 16, alignItems: 'center', width: '100%' }}>
            <Image
                source={{ uri, headers }}
                style={{
                    width: '100%',
                    aspectRatio: aspectRatio || 16 / 9,
                    borderRadius: 16,
                    backgroundColor: theme.colors.surfaceVariant,
                }}
                contentFit="contain"
                cachePolicy="disk"
                onLoad={(e) => {
                    const { width, height } = e.source;
                    if (width && height) {
                        setAspectRatio(width / height);
                    }
                }}
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

const SkeletonItem = memo(({ isGrid }: { isGrid?: boolean }) => {
    const theme = useTheme();
    const opacity = useSharedValue(0.1);

    useEffect(() => {
        opacity.value = withRepeat(
            withSequence(
                withTiming(0.25, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
                withTiming(0.1, { duration: 1000, easing: Easing.inOut(Easing.ease) })
            ),
            -1,
            true
        );
    }, [opacity]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    if (isGrid) {
        return (
            <Animated.View style={[animatedStyle, { width: ASSET_ITEM_WIDTH, height: ASSET_ITEM_WIDTH * (0.8 + Math.random() * 0.6), marginVertical: 6, borderRadius: 16, backgroundColor: theme.colors.onSurfaceVariant }]} />
        );
    }

    return (
        <Surface elevation={1} style={{ borderRadius: 16, overflow: 'hidden', marginVertical: 4, marginHorizontal: 0, backgroundColor: theme.colors.surface }}>
            <View style={{ padding: 16, height: 76, justifyContent: 'center' }}>
                <Animated.View style={[animatedStyle, { height: 18, width: '70%', backgroundColor: theme.colors.onSurfaceVariant, borderRadius: 4, marginBottom: 12 }]} />
                <Animated.View style={[animatedStyle, { height: 12, width: '30%', backgroundColor: theme.colors.onSurfaceVariant, borderRadius: 4 }]} />
            </View>
        </Surface>
    );
});

const ListingSkeleton = memo(({ isGrid }: { isGrid?: boolean }) => {
    const items = Array.from({ length: isGrid ? 12 : 8 });
    if (isGrid) {
        return (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: ASSET_CONTAINER_PADDING }}>
                <View style={{ width: ASSET_ITEM_WIDTH }}>
                    {Array.from({ length: 4 }).map((_, i) => <SkeletonItem key={i} isGrid />)}
                </View>
                <View style={{ width: ASSET_ITEM_WIDTH }}>
                    {Array.from({ length: 4 }).map((_, i) => <SkeletonItem key={i * 2 + 1} isGrid />)}
                </View>
            </View>
        );
    }
    return (
        <View style={{ paddingHorizontal: 0, width: '100%' }}>
            {items.map((_, i) => <SkeletonItem key={i} />)}
        </View>
    );
});

// Sub-component for Asset Item
const getAssetIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
        // Video
        case 'mp4': case 'm4v': case 'mov': case 'avi': case 'wmv': case 'flv': case 'mkv': case 'webm':
            return 'movie-open';
        // Audio
        case 'mp3': case 'wav': case 'ogg': case 'm4a': case 'aac': case 'flac':
            return 'music';
        // Documents
        case 'pdf':
            return 'file-pdf-box';
        case 'doc': case 'docx':
            return 'file-word';
        case 'xls': case 'xlsx':
            return 'file-excel';
        case 'ppt': case 'pptx':
            return 'file-powerpoint';
        case 'txt': case 'md':
            return 'file-document';
        case 'zip': case 'rar': case '7z': case 'tar': case 'gz':
            return 'zip-box';
        default:
            return 'file-question';
    }
};

const AssetItem = memo(({ item, headers, onInsert, onRename, onDelete }: { item: any, headers: any, onInsert: () => void, onRename: () => void, onDelete: () => void }) => {
    const theme = useTheme();
    const [aspectRatio, setAspectRatio] = useState<number>(1); // Default to square until loaded

    const isImage = item.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
    const icon = getAssetIcon(item.name);

    return (
        <View style={[styles.assetCard, { backgroundColor: theme.colors.surfaceVariant, opacity: item.isPending ? 0.6 : 1 }]}>
            <TouchableOpacity onPress={onInsert} style={styles.assetThumbContainer}>
                {isImage ? (
                    <Image
                        source={{ uri: item.download_url, headers }}
                        style={[styles.assetImage, { aspectRatio }]}
                        contentFit="cover"
                        cachePolicy="disk"
                        onLoad={(e) => {
                            if (e.source.width && e.source.height) {
                                setAspectRatio(e.source.width / e.source.height);
                            }
                        }}
                    />
                ) : (
                    <View style={[styles.assetIconPlaceholder, { aspectRatio: 1, backgroundColor: theme.colors.surfaceVariant }]}>
                        <MaterialCommunityIcons name={icon as any} size={48} color={theme.colors.onSurfaceVariant} />
                    </View>
                )}
                <View style={styles.assetOverlay}>
                    <IconButton
                        icon="cursor-text"
                        iconColor="white"
                        size={18}
                        onPress={onRename}
                        style={{ backgroundColor: 'rgba(0,0,0,0.3)', margin: 2 }}
                    />
                    <IconButton
                        icon="delete"
                        iconColor={theme.colors.error}
                        size={18}
                        onPress={onDelete}
                        style={{ backgroundColor: 'rgba(0,0,0,0.3)', margin: 2 }}
                    />
                </View>
            </TouchableOpacity>
            <View style={{ backgroundColor: theme.colors.surface, padding: 4 }}>
                <PaperText variant="bodySmall" numberOfLines={1} style={styles.assetCardName}>{item.name}</PaperText>
            </View>
        </View>
    );
});

// Sub-component for Assets Manager
const AssetsManager = ({ repoPath, staticDir, assetsDir, onInsert }: { repoPath: string | null, staticDir: string, assetsDir: string, onInsert: (item: any) => void }) => {
    const { config, assetCache, setRepoAssetCache, showToast } = useAppContext();
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
            const cleanStatic = repoConfig && repoConfig.useStaticFolder !== false ? staticDir.replace(/^\/+|\/+$/g, '') : '';
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

            const allFiles = response.data.filter((f: any) => f.type === 'file');
            await setRepoAssetCache(repoPath, allFiles);
        } catch (e: any) {
            console.error('[Assets] Fetch failed', e.message);
            setFetchError(e.response?.status === 404 ? 'Directory not found' : (e.message || 'Fetch failed'));
        } finally {
            setIsLoading(false);
        }
    }, [repoPath, repoConfig?.useStaticFolder, staticDir, assetsDir, setRepoAssetCache]);

    useEffect(() => {
        if (repoPath) {
            // Clear current view if repo/path changes radically
            setRepoAssetCache(repoPath, []);
            fetchAssets();
        }
    }, [repoPath, repoConfig?.useStaticFolder, staticDir, assetsDir]);

    const handleDelete = async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        if (!selectedAsset || !repoPath) return;
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedAsset.path}`, {
                headers: { Authorization: `token ${token}` },
                data: {
                    message: `fix!(assets): deleted ${selectedAsset.name}`,
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

    const handleRename = useCallback(async (newName: string) => {
        if (!selectedAsset || !newName || !repoPath || !repoConfig) return;
        const ext = selectedAsset.name.split('.').pop();
        const cleanName = newName.includes('.') ? newName : `${newName}.${ext}`;

        const oldAsset = { ...selectedAsset };
        const previousAssets = [...assets];
        const parentDir = oldAsset.path.includes('/') ? oldAsset.path.substring(0, oldAsset.path.lastIndexOf('/')) : '';
        const newPath = parentDir ? `${parentDir}/${cleanName}`.replace(/\/+/g, '/') : cleanName;

        // Optimistically update UI
        const optimisticAssets = assets.map(a => a.path === oldAsset.path ? { ...a, name: cleanName, path: newPath } : a);
        setRepoAssetCache(repoPath, optimisticAssets);
        setRenameVisible(false);

        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const contentResponse = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${oldAsset.path}`, {
                headers: { Authorization: `token ${token}` }
            });
            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, {
                message: `fix!(assets): renamed ${oldAsset.name} to ${cleanName}`,
                content: contentResponse.data.content,
            }, {
                headers: { Authorization: `token ${token}` }
            });
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${oldAsset.path}`, {
                headers: { Authorization: `token ${token}` },
                data: {
                    message: `fix!(assets): cleaned up after rename ${oldAsset.name} to ${cleanName}`,
                    sha: oldAsset.sha
                }
            });
            await setRepoAssetCache(repoPath, optimisticAssets);
        } catch (e: any) {
            console.error('[Assets] Rename failed', e.response?.data || e.message);
            // Revert on failure
            setRepoAssetCache(repoPath, previousAssets);
            showToast(`Rename failed: ${e.message}`, 'error');
        } finally {
            setSelectedAsset(null);
        }
    }, [selectedAsset, repoPath, repoConfig, assets, staticDir, assetsDir, setRepoAssetCache]);

    if (isLoading && assets.length === 0) {
        return (
            <ScrollView contentContainerStyle={styles.assetsGrid}>
                <ListingSkeleton isGrid />
            </ScrollView>
        );
    }

    if (fetchError || assets.length === 0) {
        return (
            <View style={styles.center}>
                <PaperText style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
                    {fetchError || `No assets found in ${[staticDir, assetsDir].filter(Boolean).join('/') || 'root'}`}
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
                contentContainerStyle={styles.assetsGrid}
                refreshControl={
                    <RefreshControl
                        refreshing={isLoading}
                        onRefresh={() => fetchAssets()}
                        colors={[theme.colors.primary]}
                        progressBackgroundColor={theme.colors.surface}
                    />
                }
                renderItem={null}
                ListHeaderComponent={
                    assets.length > 0 ? (
                        <View style={styles.assetRow}>
                            <View style={styles.assetColumn}>
                                {assets.filter((_, i) => i % 2 === 0).map(item => (
                                    <AssetItem
                                        key={item.path}
                                        item={item}
                                        headers={headers}
                                        onInsert={() => onInsert(item)}
                                        onRename={() => { setSelectedAsset(item); setRenameVisible(true); }}
                                        onDelete={() => { setSelectedAsset(item); setDeleteConfirmVisible(true); }}
                                    />
                                ))}
                                {isLoading && [1, 2, 3].map(i => <SkeletonItem key={`sk1-${i}`} isGrid />)}
                            </View>
                            <View style={styles.assetColumn}>
                                {assets.filter((_, i) => i % 2 !== 0).map(item => (
                                    <AssetItem
                                        key={item.path}
                                        item={item}
                                        headers={headers}
                                        onInsert={() => onInsert(item)}
                                        onRename={() => { setSelectedAsset(item); setRenameVisible(true); }}
                                        onDelete={() => { setSelectedAsset(item); setDeleteConfirmVisible(true); }}
                                    />
                                ))}
                                {isLoading && (assets.length % 2 !== 0 ? [1, 2, 3, 4] : [1, 2, 3]).map(i => <SkeletonItem key={`sk2-${i}`} isGrid />)}
                            </View>
                        </View>
                    ) : null
                }
                ListFooterComponent={null}
                ListEmptyComponent={
                    isLoading ? (
                        <ListingSkeleton isGrid />
                    ) : (
                        <View style={styles.emptyState}>
                            <PaperText style={{ opacity: 0.5 }}>No assets found</PaperText>
                        </View>
                    )
                }
            />

            < Portal >
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
            </Portal >
        </View >
    );
};


export default function Editor() {
    const { path, new: isNewParam, title: titleParam, repo: repoParam } = useLocalSearchParams();
    const isNew = isNewParam === 'true';
    const decodedPath = decodeURIComponent(path as string);
    const isLocalDraft = decodedPath.startsWith('draft_');
    const draftId = isLocalDraft ? decodedPath.replace('draft_', '') : null;

    const { config, localDrafts, saveDraft, deleteDraft, setRepoAssetCache, assetCache, showToast } = useAppContext();
    const theme = useTheme();
    const router = useRouter();

    const repoPath = (repoParam as string) || config.repo;
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
    const [pickedAssetExtension, setPickedAssetExtension] = useState('');
    const [pickedAssetSize, setPickedAssetSize] = useState<number | undefined>();
    const [pickedAssetType, setPickedAssetType] = useState<'image' | 'video' | 'file'>('image');
    const [isAssetTypeVisible, setIsAssetTypeVisible] = useState(false);
    const [isImageNameVisible, setIsImageNameVisible] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    // Commit UI states
    const [isCommitModalVisible, setIsCommitModalVisible] = useState(false);
    const [isLinkModalVisible, setIsLinkModalVisible] = useState(false);

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
        paragraph: {
            marginVertical: 8,
            lineHeight: 24,
        },
        blockquote: {
            borderColor: theme.colors.primary,
            borderLeftWidth: 6,
            marginLeft: 0,
            paddingLeft: 16,
            paddingVertical: 8,
            marginVertical: 12,
            backgroundColor: theme.colors.surfaceVariant + '40',
            color: theme.colors.onSurfaceVariant,
            fontStyle: 'italic',
            borderRadius: 4,
        },
        code_block: {
            fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
            backgroundColor: theme.dark ? 'rgba(255, 255, 255, 0.08)' : theme.colors.surfaceVariant,
            color: theme.colors.onSurfaceVariant,
            padding: 16,
            borderRadius: 12,
            fontSize: 14,
            marginVertical: 16,
            borderWidth: 1,
            borderColor: theme.colors.outlineVariant,
        },
        fence: {
            fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
            backgroundColor: theme.dark ? 'rgba(255, 255, 255, 0.08)' : theme.colors.surfaceVariant,
            color: theme.colors.onSurfaceVariant,
            padding: 16,
            borderRadius: 12,
            fontSize: 14,
            marginVertical: 16,
            borderWidth: 1,
            borderColor: theme.colors.outlineVariant,
        },
        code_inline: {
            fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
            backgroundColor: theme.dark ? 'rgba(255, 255, 255, 0.12)' : theme.colors.surfaceVariant,
            color: theme.colors.secondary,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 6,
            fontSize: 14,
        },
        table: {
            borderWidth: 1,
            borderColor: theme.colors.outlineVariant,
            borderRadius: 8,
            marginVertical: 16,
            overflow: 'hidden',
        },
        tr: {
            borderBottomWidth: 1,
            borderColor: theme.colors.outlineVariant,
            flexDirection: 'row',
        },
        th: {
            padding: 12,
            backgroundColor: theme.colors.surfaceVariant,
            fontWeight: 'bold',
            flex: 1,
        },
        td: {
            padding: 12,
            flex: 1,
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
        handwriting: {
            fontFamily: Platform.select({ ios: 'Bradley Hand', android: 'cursive', default: 'cursive' }),
            fontSize: Platform.select({ ios: 18, default: 16 }),
            textDecorationLine: 'underline',
            fontWeight: '300',
            letterSpacing: 0.5,
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
                const staticPath = repoConfig.useStaticFolder !== false ? repoConfig.staticDir.replace(/^\/+|\/+$/g, '') : '';

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
        text: (node: any, children: any, parent: any, styles: any) => {
            const content = node.content;
            // Split into parts to handle custom markers
            const parts = content.split(/(\[\[(?:HW|LIKE|REPLY):.*?\]\])/g);

            return (
                <PaperText key={node.key}>
                    {parts.map((part: string, i: number) => {
                        const hwMatch = part.match(/^\[\[HW:(.*?)\]\]$/);
                        if (hwMatch) {
                            return <PaperText key={i} style={styles.handwriting}>{hwMatch[1]}</PaperText>;
                        }

                        const likeMatch = part.match(/^\[\[LIKE:(.*?)\|(.*?)\]\]$/);
                        if (likeMatch) {
                            const [url, label] = [likeMatch[1], likeMatch[2]];
                            return (
                                <PaperText key={i} onPress={() => Linking.openURL(url)}>
                                    <MaterialCommunityIcons name="heart" size={16} color={theme.colors.error} />
                                    <PaperText style={styles.link}>{' '}{label}</PaperText>
                                </PaperText>
                            );
                        }

                        const replyMatch = part.match(/^\[\[REPLY:(.*?)\|(.*?)\]\]$/);
                        if (replyMatch) {
                            const [url, label] = [replyMatch[1], replyMatch[2]];
                            return (
                                <PaperText key={i} onPress={() => Linking.openURL(url)}>
                                    <MaterialCommunityIcons name="reply" size={16} color={theme.colors.primary} />
                                    <PaperText style={styles.link}>{' '}{label}</PaperText>
                                </PaperText>
                            );
                        }

                        return part;
                    })}
                </PaperText>
            );
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
                message: msg || (isNew ? `add!(content): created ${title}` : `fix!(content): updated ${title}`),
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
            showToast('Published to GitHub', 'success');

            // Redirect to the new post URL if it was a draft
            if (isLocalDraft) {
                router.replace(`/editor/${encodeURIComponent(cleanPostPath)}`);
            }
        } catch (e: any) {
            console.error('[Editor] Save failed', e);
            const githubError = e.response?.data?.message || e.message || 'Unknown error';
            showToast(`Save failed: ${githubError}`, 'error');
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

            let currentDirPath: string | undefined = undefined;
            if (isLocalDraft && draftId) {
                const existingDraft = localDrafts.find(d => d.id === draftId);
                currentDirPath = existingDraft?.dirPath;
            } else if (repoConfig && repoPath) {
                const contentDir = repoConfig.contentDir.replace(/\/+$/, '');
                if (decodedPath.startsWith(contentDir + '/')) {
                    const relativePath = decodedPath.substring(contentDir.length + 1);
                    const lastSlash = relativePath.lastIndexOf('/');
                    if (lastSlash > -1) {
                        currentDirPath = relativePath.substring(0, lastSlash);
                    } else {
                        currentDirPath = '';
                    }
                }
            }

            await saveDraft({
                id,
                title: calculatedTitle || 'Untitled Draft',
                content,
                lastModified: new Date().toISOString(),
                repoPath: repoPath || '',
                dirPath: currentDirPath
            });

            showToast('Draft saved locally', 'success');

            // If it was a new post being saved as draft, redirect unless suppressing
            if (!isLocalDraft && shouldRedirect) {
                router.replace(`/editor/draft_${id}`);
            }
        } catch (e: any) {
            showToast(`Draft save failed: ${e.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handlePickAsset = async (type: 'image' | 'video' | 'file') => {
        setIsAssetTypeVisible(false);
        setPickedAssetType(type);
        try {
            if (type === 'image' || type === 'video') {
                const result = await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: type === 'image' ? ['images'] : ['videos'],
                    allowsEditing: type === 'image',
                    quality: 0.8,
                });

                if (!result.canceled && result.assets && result.assets.length > 0) {
                    const asset = result.assets[0];
                    let uri = asset.uri;
                    if (type === 'image') {
                        const resized = await ImageManipulator.manipulateAsync(
                            asset.uri,
                            [{ resize: { width: 1200 } }],
                            { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
                        );
                        uri = resized.uri;
                    }
                    setLastPickedUri(uri);
                    const originalName = asset.fileName || '';
                    const parts = originalName.split('.');
                    const ext = parts.pop() || '';
                    setPickedFilename('');
                    setPickedAssetExtension(ext);
                    setPickedAssetSize(asset.fileSize);
                    setIsImageNameVisible(true);
                }
            } else {
                const result = await DocumentPicker.getDocumentAsync({
                    type: '*/*',
                    copyToCacheDirectory: true,
                });

                if (!result.canceled && result.assets && result.assets.length > 0) {
                    const asset = result.assets[0];
                    setLastPickedUri(asset.uri);
                    const originalName = asset.name || '';
                    const parts = originalName.split('.');
                    const ext = parts.pop() || '';
                    setPickedFilename('');
                    setPickedAssetExtension(ext);
                    setPickedAssetSize(asset.size);
                    setIsImageNameVisible(true);
                }
            }
        } catch (e) {
            console.error('Pick failed', e);
            showToast('Failed to pick file', 'error');
        }
    };

    const confirmLink = (url: string, text: string, type: string) => {
        setIsLinkModalVisible(false);
        let linkStr = '';
        if (type === 'mention') {
            linkStr = `[${text || url}](${url})`;
        } else if (type === 'like') {
            linkStr = `<a class="u-like-of" href="${url}">${text || url}</a>`;
        } else if (type === 'reply') {
            linkStr = `<a class="u-in-reply-to" href="${url}">${text || url}</a>`;
        }

        const newContent = content.substring(0, selection.start) + linkStr + content.substring(selection.end);
        setContent(newContent);
        showToast('Link inserted', 'success');
    };

    const confirmAsset = async (name: string) => {
        if (!lastPickedUri || !name || !repoConfig || !repoPath) return;

        setIsImageNameVisible(false);
        setIsUploading(true);

        const finalName = name.endsWith(`.${pickedAssetExtension}`) ? name : `${name}.${pickedAssetExtension}`;
        const assetsPath = repoConfig.assetsDir.replace(/^\/+|\/+$/g, '');
        const staticPath = repoConfig.useStaticFolder !== false ? repoConfig.staticDir.replace(/^\/+|\/+$/g, '') : '';

        const relativePath = `/${[assetsPath, finalName].filter(Boolean).join('/')}`;
        const assetPath = [staticPath, assetsPath, finalName].filter(Boolean).join('/');

        const isImg = finalName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        const markdown = isImg ? `![${finalName}](${relativePath})` : `[${finalName}](${relativePath})`;

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
                message: `add!(assets): uploaded ${finalName}`,
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
            const newContent = content.substring(0, selection.start) + markdown + content.substring(selection.end);
            setContent(newContent);
            showToast('Asset uploaded and inserted', 'success');
            setLastPickedUri(null);
        } catch (e: any) {
            console.error('Upload failed', e);
            showToast(`Upload failed: ${e.message}`, 'error');
        } finally {
            setIsUploading(false);
        }
    };

    const handleInsertAsset = (item: any) => {
        const filename = item.name;
        const isConfigured = !!repoConfig;
        const contentDirClean = repoConfig?.contentDir.replace(/^\/+|\/+$/g, '') || '';
        const isUnderContent = isConfigured && decodedPath.startsWith(contentDirClean) && contentDirClean !== '';

        let relativePath;
        if (isUnderContent && repoConfig) {
            const assetsPath = repoConfig.assetsDir.replace(/^\/+|\/+$/g, '');
            relativePath = `/${[assetsPath, filename].filter(Boolean).join('/')}`;
        } else {
            // Exact repo path for non-content files or unconfigured repos
            relativePath = `/${item.path}`;
        }

        const isImg = filename.match(/\.(jpg|jpeg|png|gif|webp)$/i);
        const markdown = isImg ? `![${filename}](${relativePath})` : `[${filename}](${relativePath})`;
        const newContent = content.substring(0, selection.start) + markdown + content.substring(selection.end);
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

        if (router.canGoBack()) {
            router.back();
        } else {
            // Fallback to files if we're at the root (prevents closing app)
            router.replace('/files');
        }
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
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        // Clear autosave
        await AsyncStorage.removeItem(AUTOSAVE_KEY);
        // Just go back without saving
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/files');
        }
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
                            let clean = content.replace(/^---\s*[\s\S]*?\n---\s*\n?/, '').replace(/^\+\+\+\s*[\s\S]*?\n\+\+\+\s*\n?/, '');

                            // Custom pre-processing for handwriting and webmention links
                            // [_Text_] -> [[HW:Text]]
                            clean = clean.replace(/\[_([\s\S]*?)_\]/g, '[[HW:$1]]');

                            // <a class="u-like-of" href="url">text</a> -> [[LIKE:url|text]]
                            clean = clean.replace(/<a class="u-like-of" href="([^"]+)">(.*?)<\/a>/g, '[[LIKE:$1|$2]]');

                            // <a class="u-in-reply-to" href="url">text</a> -> [[REPLY:url|text]]
                            clean = clean.replace(/<a class="u-in-reply-to" href="([^"]+)">(.*?)<\/a>/g, '[[REPLY:$1|$2]]');

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
                        {/* Floating Action Buttons for adding content in Edit mode */}
                        <View style={styles.fabContainer}>
                            <IconButton
                                icon="link-plus"
                                mode="contained"
                                size={28}
                                style={styles.fabItem}
                                onPress={() => setIsLinkModalVisible(true)}
                            />
                            <IconButton
                                icon="file-plus-outline"
                                mode="contained"
                                size={28}
                                style={styles.fabItem}
                                onPress={() => setIsAssetTypeVisible(true)}
                            />
                        </View>
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
                <AssetTypeDialog
                    visible={isAssetTypeVisible}
                    onDismiss={() => setIsAssetTypeVisible(false)}
                    onSelect={handlePickAsset}
                />

                <LinkMentionDialog
                    visible={isLinkModalVisible}
                    onDismiss={() => setIsLinkModalVisible(false)}
                    onConfirm={confirmLink}
                />

                <ImageNameDialog
                    visible={isImageNameVisible}
                    onDismiss={() => setIsImageNameVisible(false)}
                    onConfirm={confirmAsset}
                    initialValue={pickedFilename}
                    extension={pickedAssetExtension}
                    size={pickedAssetSize}
                />

                <CommitDialog
                    visible={isCommitModalVisible}
                    onDismiss={() => setIsCommitModalVisible(false)}
                    onPublish={handlePublish}
                    initialMsg={isNew ? `add!(content): created ${title}` : `fix!(content): updated ${title}`}
                    isDraft={isLocalDraft}
                    initialFilename={title}
                />
            </Portal>
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
    assetsGrid: {
        paddingTop: 8,
        paddingBottom: 100,
    },
    assetRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: ASSET_CONTAINER_PADDING,
    },
    assetColumn: {
        width: ASSET_ITEM_WIDTH,
    },
    assetCard: {
        width: ASSET_ITEM_WIDTH,
        marginVertical: 6,
        borderRadius: 16,
        overflow: 'hidden',
        elevation: 2,
    },
    assetThumbContainer: { position: 'relative' },
    assetImage: { width: '100%' },
    assetIconPlaceholder: {
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    assetOverlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        flexDirection: 'row',
        padding: 4
    },
    assetCardName: { fontSize: 11, padding: 4, textAlign: 'center' },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 40,
    },
    fabContainer: {
        position: 'absolute',
        right: 16,
        bottom: 16,
        gap: 12, // Space between buttons
    },
    fabItem: {
        margin: 0,
        elevation: 4,
    },
});
