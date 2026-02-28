import { MaterialCommunityIcons } from '@expo/vector-icons';
import axios from 'axios';
import { Buffer } from 'buffer';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { memo, useCallback, useEffect, useState } from 'react';
import { BackHandler, Dimensions, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Appbar, Button, Dialog, FAB, IconButton, Portal, Searchbar, Surface, Text, TextInput, TouchableRipple, useTheme } from 'react-native-paper';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useAppContext } from '../context/AppContext';

const { width } = Dimensions.get('window');

// Formatter for relative dates
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

const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const frontTruncate = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return '...' + text.slice(-(maxLength - 3));
};

const SkeletonItem = memo(() => {
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

    return (
        <Surface elevation={1} style={{ borderRadius: 16, overflow: 'hidden', marginVertical: 4, marginHorizontal: 16, backgroundColor: theme.colors.surface }}>
            <View style={{ padding: 16, height: 60, flexDirection: 'row', alignItems: 'center' }}>
                <Animated.View style={[animatedStyle, { width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.onSurfaceVariant, marginRight: 16 }]} />
                <Animated.View style={[animatedStyle, { height: 20, width: '60%', backgroundColor: theme.colors.onSurfaceVariant, borderRadius: 4 }]} />
            </View>
        </Surface>
    );
});

// Reusable Dialogs
const RenameDialog = ({ visible, onDismiss, onRename, initialValue, title = "Rename", label = "Name" }: { visible: boolean, onDismiss: () => void, onRename: (val: string) => void, initialValue: string, title?: string, label?: string }) => {
    const theme = useTheme();
    const [localValue, setLocalValue] = useState(initialValue);
    useEffect(() => { if (visible) setLocalValue(initialValue); }, [visible, initialValue]);
    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Content>
                <TextInput label={label} value={localValue} onChangeText={setLocalValue} mode="flat" autoFocus style={{ backgroundColor: theme.colors.surfaceVariant }} />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button onPress={() => onRename(localValue)} disabled={!localValue} mode="contained" style={{ borderRadius: 20 }}>Confirm</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

const NewMarkdownDialog = ({ visible, onDismiss, onCreate }: { visible: boolean, onDismiss: () => void, onCreate: (val: string) => void }) => {
    const theme = useTheme();
    const [localValue, setLocalValue] = useState('');
    useEffect(() => { if (visible) setLocalValue(''); }, [visible]);
    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>New Markdown File</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    label="Filename"
                    value={localValue}
                    onChangeText={setLocalValue}
                    mode="flat"
                    autoFocus
                    style={{ backgroundColor: theme.colors.surfaceVariant }}
                    right={<TextInput.Affix text=".md" />}
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button onPress={() => onCreate(localValue)} disabled={!localValue} mode="contained" style={{ borderRadius: 20 }}>Create</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

const ImageNameDialog = ({ visible, onDismiss, onConfirm, initialValue, extension, size }: { visible: boolean, onDismiss: () => void, onConfirm: (val: string) => void, initialValue: string, extension: string, size?: number }) => {
    const theme = useTheme();
    const [localValue, setLocalValue] = useState(initialValue);
    useEffect(() => { if (visible) setLocalValue(initialValue); }, [visible, initialValue]);
    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>New Asset</Dialog.Title>
            <Dialog.Content>
                <TextInput label="Filename" value={localValue} onChangeText={setLocalValue} mode="flat" autoFocus style={{ backgroundColor: theme.colors.surfaceVariant }} right={extension ? <TextInput.Affix text={'.' + extension} /> : null} />
                {size ? (
                    <Text variant="bodySmall" style={{ marginTop: 8, opacity: 0.6, textAlign: 'right' }}>File size: {formatBytes(size)}</Text>
                ) : null}
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button mode="contained" onPress={() => onConfirm(localValue)} style={{ borderRadius: 20 }}>Upload</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

// Item Renderers
const FileItem = memo(({ item, onRename, onDelete, onCopy, onMove, onPress }: { item: any, onRename: () => void, onDelete: () => void, onCopy: () => void, onMove: () => void, onPress: () => void }) => {
    const theme = useTheme();
    const isDir = item.type === 'dir';
    return (
        <Surface elevation={1} style={{ borderRadius: 16, overflow: 'hidden', marginVertical: 4, marginHorizontal: 16, backgroundColor: isDir ? theme.colors.surfaceVariant : theme.colors.surface }}>
            <TouchableRipple onPress={onPress} style={{ flex: 1 }} rippleColor={theme.colors.onSurfaceVariant + '1F'} borderless={true}>
                <View style={styles.itemCard}>
                    <View style={styles.itemHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                            <MaterialCommunityIcons
                                name={isDir ? "folder" : "file-outline"}
                                size={24}
                                color={isDir ? theme.colors.primary : theme.colors.outline}
                                style={{ marginRight: 12 }}
                            />
                            <Text variant="titleMedium" numberOfLines={1} style={{ flex: 1, fontWeight: isDir ? '700' : '400' }}>{item.name}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                            <IconButton mode="contained-tonal" icon="content-copy" size={18} iconColor={theme.colors.secondary} containerColor={isDir ? theme.colors.surface : undefined} onPress={onCopy} />
                            <IconButton mode="contained-tonal" icon="file-move-outline" size={18} iconColor={theme.colors.secondary} containerColor={isDir ? theme.colors.surface : undefined} onPress={onMove} />
                            <IconButton mode="contained-tonal" icon="cursor-text" size={18} iconColor={theme.colors.primary} containerColor={isDir ? theme.colors.surface : undefined} onPress={onRename} />
                            <IconButton mode="contained-tonal" icon="delete-outline" size={18} iconColor={theme.colors.error} containerColor={isDir ? theme.colors.surface : undefined} onPress={onDelete} />
                        </View>
                    </View>
                </View>
            </TouchableRipple>
        </Surface>
    );
});

export default function AdvancedFiles() {
    const theme = useTheme();
    const router = useRouter();
    const { repo: repoParam } = useLocalSearchParams();
    const { config, showToast } = useAppContext();
    const repoPath = (repoParam as string) || config.repo;
    const isConfigured = repoPath ? !!config.repoConfigs[repoPath] : false;

    const [currentPath, setCurrentPath] = useState('');
    const [items, setItems] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Dialog States
    const [isRenameVisible, setIsRenameVisible] = useState(false);
    const [isDeleteVisible, setIsDeleteVisible] = useState(false);
    const [isNewFileVisible, setIsNewFileVisible] = useState(false);
    const [isNewDirVisible, setIsNewDirVisible] = useState(false);
    const [isUploadNameVisible, setIsUploadNameVisible] = useState(false);
    const [selectedItem, setSelectedItem] = useState<any>(null);
    const [lastPickedUri, setLastPickedUri] = useState<string | null>(null);
    const [pickedAssetExtension, setPickedAssetExtension] = useState('');
    const [pickedAssetSize, setPickedAssetSize] = useState<number | undefined>();
    const [searchQuery, setSearchQuery] = useState('');
    const [clipboard, setClipboard] = useState<{ item: any, action: 'copy' | 'move' } | null>(null);

    const filteredItems = React.useMemo(() => {
        if (!searchQuery) return items;
        return items.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [items, searchQuery]);

    const fetchRecursive = async (path: string, token: string | null): Promise<any[]> => {
        if (!repoPath) return [];
        let all: any[] = [];
        try {
            const res = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${path}`, {
                headers: token ? { Authorization: `token ${token}` } : {}
            });
            const items = Array.isArray(res.data) ? res.data : [res.data];
            for (const item of items) {
                all.push(item);
                if (item.type === 'dir') {
                    const sub = await fetchRecursive(item.path, token);
                    all = [...all, ...sub];
                }
            }
        } catch (e: any) {
            console.error('[Advanced] Fetch recursive failed', e.message);
        }
        return all;
    };

    const fetchItems = useCallback(async (isRefresh = false) => {
        if (!repoPath) return;
        if (isRefresh) setIsRefreshing(true);
        else {
            setIsLoading(true);
            setItems([]); // Clear current items to trigger skeletons
        }

        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const response = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${currentPath}`, {
                headers: { Authorization: `token ${token}`, 'Cache-Control': 'no-cache' }
            });
            const data = Array.isArray(response.data) ? response.data : [response.data];
            // Sort: Dirs first, then files
            const sorted = data.sort((a: any, b: any) => {
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === 'dir' ? -1 : 1;
            });
            setItems(sorted);
        } catch (e: any) {
            console.error('[Advanced] Fetch failed', e);
            showToast('Failed to fetch files', 'error');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [repoPath, currentPath]);

    useEffect(() => { fetchItems(); }, [fetchItems]);

    const handleBack = useCallback(() => {
        if (currentPath === '') {
            router.back();
            return true;
        }
        const parts = currentPath.split('/');
        parts.pop();
        setCurrentPath(parts.join('/'));
        return true;
    }, [currentPath, router]);

    useEffect(() => {
        const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBack);
        return () => backHandler.remove();
    }, [handleBack]);

    const handleRename = async (newName: string) => {
        if (!selectedItem || !repoPath || !newName) return;
        const previousItems = items;
        setIsRenameVisible(false);
        setIsLoading(true);
        setItems([]); // Clear list to show skeletons
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const oldPath = selectedItem.path;
            const newPath = currentPath ? `${currentPath}/${newName}` : newName;

            if (selectedItem.type === 'dir') {
                // Recursive Directory Rename
                const allItems = await fetchRecursive(oldPath, token);
                const filesToMove = allItems.filter(item => item.type === 'file');

                for (const file of filesToMove) {
                    const fileRes = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${file.path}`, {
                        headers: { Authorization: `token ${token}` }
                    });
                    const relativePath = file.path.substring(oldPath.length);
                    const newFilePath = newPath + relativePath;

                    await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newFilePath}`, {
                        message: `fix!(repo): moved ${file.path} to ${newFilePath}`,
                        content: fileRes.data.content,
                        sha: undefined
                    }, { headers: { Authorization: `token ${token}` } });

                    await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${file.path}`, {
                        headers: { Authorization: `token ${token}` },
                        data: { message: `fix!(repo): deleted old file after move`, sha: fileRes.data.sha }
                    });
                }
            } else {
                const fileRes = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${oldPath}`, {
                    headers: { Authorization: `token ${token}` }
                });

                await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, {
                    message: `fix!(repo): renamed ${selectedItem.name} to ${newName}`,
                    content: fileRes.data.content,
                    sha: undefined
                }, { headers: { Authorization: `token ${token}` } });

                await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${oldPath}`, {
                    headers: { Authorization: `token ${token}` },
                    data: { message: `fix!(repo): deleted old file after rename`, sha: fileRes.data.sha }
                });
            }

            showToast('Renamed successfully', 'success');
            fetchItems();
        } catch (e: any) {
            console.error('Rename failed', e);
            showToast('Rename failed', 'error');
            setItems(previousItems);
            setIsLoading(false);
        } finally {
            setSelectedItem(null);
        }
    };

    const handleDelete = async () => {
        if (!selectedItem || !repoPath) return;
        const previousItems = items;
        setIsDeleteVisible(false);
        setIsLoading(true);
        setItems([]); // Clear list to show skeletons
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');

            if (selectedItem.type === 'dir') {
                const allItems = await fetchRecursive(selectedItem.path, token);
                const filesToDelete = allItems.filter(item => item.type === 'file');

                for (const file of filesToDelete) {
                    await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${file.path}`, {
                        headers: { Authorization: `token ${token}` },
                        data: { message: `fix!(repo): deleted ${file.path} (recursive)`, sha: file.sha }
                    });
                }
            } else {
                await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedItem.path}`, {
                    headers: { Authorization: `token ${token}` },
                    data: { message: `fix!(repo): deleted ${selectedItem.name}`, sha: selectedItem.sha }
                });
            }
            showToast('Deleted successfully', 'success');
            fetchItems();
        } catch (e: any) {
            console.error('Delete failed', e.message);
            showToast('Delete failed', 'error');
            setItems(previousItems);
            setIsLoading(false);
        } finally {
            setSelectedItem(null);
        }
    };

    const handlePaste = async () => {
        if (!clipboard || !repoPath) return;
        const previousItems = items;
        setIsLoading(true);
        setItems([]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const sourceItem = clipboard.item;
            const destFolder = currentPath;

            const itemsToProcess = sourceItem.type === 'dir'
                ? await fetchRecursive(sourceItem.path, token)
                : [sourceItem];

            for (const item of itemsToProcess) {
                if (item.type === 'dir') continue;
                const fileRes = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${item.path}`, {
                    headers: { Authorization: `token ${token}` }
                });
                const parentPathIndex = sourceItem.path.lastIndexOf('/');
                const relativePath = parentPathIndex === -1 ? '/' + item.path : item.path.substring(parentPathIndex);
                const newFilePath = (destFolder + relativePath).replace(/^\/+/, '');

                await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newFilePath}`, {
                    message: `${clipboard.action === 'move' ? 'fix!(repo)' : 'add!(repo)'}: ${clipboard.action === 'move' ? 'moved' : 'copied'} ${item.path} to ${newFilePath}`,
                    content: fileRes.data.content,
                }, { headers: { Authorization: `token ${token}` } });

                if (clipboard.action === 'move') {
                    await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${item.path}`, {
                        headers: { Authorization: `token ${token}` },
                        data: { message: `fix!(repo): deleted source after move`, sha: item.sha }
                    });
                }
            }

            showToast(`${clipboard.action === 'move' ? 'Moved' : 'Copied'} successfully`, 'success');
            setClipboard(null);
            fetchItems();
        } catch (e: any) {
            showToast('Paste failed', 'error');
            console.error('Paste failed', e);
            setItems(previousItems);
            setIsLoading(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateFile = async (name: string) => {
        if (!repoPath || !name) return;
        const previousItems = items;
        setIsNewFileVisible(false);
        setIsLoading(true);
        setItems([]); // Clear list to show skeletons
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const isGitKeep = name.toLowerCase().endsWith('.gitkeep');
            const fullName = (isGitKeep || name.toLowerCase().endsWith('.md')) ? name : `${name}.md`;
            const path = currentPath ? `${currentPath}/${fullName}` : fullName;
            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${path}`, {
                message: `add!(content): created ${fullName}`,
                content: Buffer.from('').toString('base64'),
            }, { headers: { Authorization: `token ${token}` } });
            showToast(isGitKeep ? 'Directory created' : 'File created', 'success');
            fetchItems();
            if (!isGitKeep) {
                router.push(`/editor/${encodeURIComponent(path)}?repo=${encodeURIComponent(repoPath)}`);
            }
        } catch (e: any) {
            showToast('Creation failed', 'error');
            setItems(previousItems);
            setIsLoading(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePickFile = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
            if (!result.canceled && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                setLastPickedUri(asset.uri);
                const parts = asset.name.split('.');
                const ext = parts.pop() || '';
                setPickedAssetExtension(ext);
                setPickedAssetSize(asset.size);
                setIsUploadNameVisible(true);
            }
        } catch (e) {
            showToast('Pick failed', 'error');
        }
    };

    const confirmUpload = async (name: string) => {
        if (!lastPickedUri || !name || !repoPath) return;
        const previousItems = items;
        setIsUploadNameVisible(false);
        setIsLoading(true);
        setItems([]); // Clear list to show skeletons
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const finalName = name.endsWith(`.${pickedAssetExtension}`) ? name : `${name}.${pickedAssetExtension}`;
            const path = currentPath ? `${currentPath}/${finalName}` : finalName;

            const resp = await fetch(lastPickedUri);
            const blob = await resp.blob();
            const reader = new FileReader();
            reader.onloadend = async () => {
                const base64Content = (reader.result as string).split(',')[1];
                try {
                    await axios.put(`https://api.github.com/repos/${repoPath}/contents/${path}`, {
                        message: `add!(assets): uploaded ${finalName}`,
                        content: base64Content,
                    }, { headers: { Authorization: `token ${token}` } });
                    showToast('Uploaded successfully', 'success');
                    fetchItems();
                } catch (e) {
                    showToast('Upload failed', 'error');
                    setItems(previousItems);
                    setIsLoading(false);
                }
            };
            reader.readAsDataURL(blob);
        } catch (e: any) {
            showToast('Upload failed', 'error');
            setItems(previousItems);
            setIsLoading(false);
        } finally {
            setIsLoading(false);
        }
    };

    const renderItem = ({ item }: { item: any }) => (
        <FileItem
            item={item}
            onRename={() => { setSelectedItem(item); setIsRenameVisible(true); }}
            onDelete={() => { setSelectedItem(item); setIsDeleteVisible(true); }}
            onCopy={() => { setClipboard({ item, action: 'copy' }); showToast(`${item.name} copied to clipboard`, 'info'); }}
            onMove={() => { setClipboard({ item, action: 'move' }); showToast(`Moving ${item.name}...`, 'info'); }}
            onPress={() => {
                if (item.type === 'dir') {
                    setCurrentPath(item.path);
                } else {
                    if (!isConfigured) {
                        showToast('Editing disabled for unconfigured repo', 'info');
                    } else if (item.name.toLowerCase().endsWith('.md')) {
                        router.push(`/editor/${encodeURIComponent(item.path)}?repo=${encodeURIComponent(repoPath || '')}`);
                    } else {
                        showToast('Only .md files can be edited', 'info');
                    }
                }
            }}
        />
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header elevated={false} style={{ backgroundColor: theme.colors.background }}>
                <Appbar.BackAction onPress={handleBack} />
                <Appbar.Content
                    title={frontTruncate('/' + (currentPath || ''), 35)}
                    titleStyle={{ fontWeight: 'bold', fontSize: 18 }}
                />
                <Appbar.Action icon="refresh" onPress={() => fetchItems(true)} />
            </Appbar.Header>

            <View style={styles.searchContainer}>
                <Searchbar
                    placeholder="Search files..."
                    onChangeText={setSearchQuery}
                    value={searchQuery}
                    style={[styles.searchbar, { backgroundColor: theme.colors.surfaceVariant }]}
                    inputStyle={styles.searchbarInput}
                    selectionColor={theme.colors.primary}
                    icon="filter-variant"
                    elevation={0}
                />
            </View>

            <FlatList
                data={filteredItems}
                keyExtractor={(item) => item.path}
                renderItem={renderItem}
                contentContainerStyle={{ paddingBottom: 100 }}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={() => fetchItems(true)}
                        colors={[theme.colors.primary]}
                        progressBackgroundColor={theme.colors.surfaceVariant}
                    />
                }
                ListEmptyComponent={
                    isLoading ? (
                        <View style={{ flex: 1, paddingVertical: 8 }}>
                            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <SkeletonItem key={i} />)}
                        </View>
                    ) : (
                        <View style={{ flex: 1, paddingTop: 100, alignItems: 'center' }}><Text variant="bodyLarge" style={{ opacity: 0.5 }}>This directory is empty</Text></View>
                    )
                }
            />

            {clipboard && (
                <View style={{ position: 'absolute', left: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <FAB
                        icon="close"
                        style={[styles.fab, { backgroundColor: theme.colors.errorContainer }]}
                        color={theme.colors.onErrorContainer}
                        onPress={() => setClipboard(null)}
                    />
                    <FAB
                        icon="content-paste"
                        label={`Paste ${clipboard.item.name}`}
                        style={[styles.fab, { backgroundColor: theme.colors.tertiaryContainer }]}
                        color={theme.colors.onTertiaryContainer}
                        onPress={handlePaste}
                    />
                </View>
            )}
            <View style={styles.fabContainer}>
                <FAB icon="folder-plus" style={[styles.fab, { backgroundColor: theme.colors.secondaryContainer }]} onPress={() => setIsNewDirVisible(true)} />
                {isConfigured && (
                    <FAB icon="file-plus" style={[styles.fab, { backgroundColor: theme.colors.primaryContainer }]} onPress={() => setIsNewFileVisible(true)} />
                )}
                <FAB icon="upload" style={[styles.fab, { backgroundColor: theme.colors.primary }]} color="white" onPress={handlePickFile} />
            </View>

            <Portal>
                <RenameDialog
                    visible={isRenameVisible}
                    onDismiss={() => setIsRenameVisible(false)}
                    onRename={handleRename}
                    initialValue={selectedItem?.name || ''}
                />

                <Dialog visible={isDeleteVisible} onDismiss={() => setIsDeleteVisible(false)} style={{ borderRadius: 28 }}>
                    <Dialog.Icon icon="alert-circle-outline" color={theme.colors.error} />
                    <Dialog.Title style={{ textAlign: 'center' }}>
                        {selectedItem?.type === 'dir' ? 'Delete Directory?' : 'Delete File?'}
                    </Dialog.Title>
                    <Dialog.Content>
                        <Text style={{ textAlign: 'center' }}>
                            Are you sure you want to delete <Text style={{ fontWeight: 'bold' }}>{selectedItem?.name}</Text>?
                            {selectedItem?.type === 'dir' ? '\n\nWARNING: This will recursively delete ALL files inside. This action cannot be undone.' : ' This action cannot be undone.'}
                        </Text>
                        {selectedItem?.type === 'dir' && (
                            <Text variant="bodySmall" style={{ textAlign: 'center', marginTop: 16, color: theme.colors.error, fontWeight: 'bold', opacity: 0.8 }}>
                                Long-press "Delete" to confirm recursive deletion
                            </Text>
                        )}
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setIsDeleteVisible(false)}>Cancel</Button>
                        <View>
                            <Button
                                onPress={() => {
                                    if (selectedItem?.type === 'dir') {
                                        showToast('Long-press to confirm folder deletion', 'info');
                                    } else {
                                        handleDelete();
                                    }
                                }}
                                onLongPress={() => {
                                    if (selectedItem?.type === 'dir') {
                                        handleDelete();
                                    }
                                }}
                                textColor={theme.colors.error}
                            >
                                Delete
                            </Button>
                        </View>
                    </Dialog.Actions>
                </Dialog>

                <NewMarkdownDialog
                    visible={isNewFileVisible}
                    onDismiss={() => setIsNewFileVisible(false)}
                    onCreate={handleCreateFile}
                />

                <RenameDialog
                    visible={isNewDirVisible}
                    onDismiss={() => setIsNewDirVisible(false)}
                    initialValue=""
                    onRename={async (name) => {
                        // Create dir by creating a .gitkeep inside
                        await handleCreateFile(`${name}/.gitkeep`);
                        setIsNewDirVisible(false);
                    }}
                    title="New Directory"
                    label="Directory Name"
                />

                <ImageNameDialog
                    visible={isUploadNameVisible}
                    onDismiss={() => setIsUploadNameVisible(false)}
                    onConfirm={confirmUpload}
                    initialValue=""
                    extension={pickedAssetExtension}
                    size={pickedAssetSize}
                />
            </Portal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    itemCard: { paddingVertical: 12, paddingHorizontal: 16 },
    itemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    fabContainer: { position: 'absolute', right: 16, bottom: 16, gap: 12, alignItems: 'center' },
    fab: {},
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
});
