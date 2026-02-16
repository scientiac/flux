import axios from 'axios';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { RectButton, Swipeable } from 'react-native-gesture-handler';
import { Appbar, Avatar, Button, Dialog, FAB, List, Portal, Searchbar, Snackbar, Text, TextInput, TouchableRipple, useTheme } from 'react-native-paper';
import { useAppContext } from '../context/AppContext';

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

// Sub-component for Rename Dialog
const RenameDialog = ({ visible, onDismiss, onRename, initialValue }: { visible: boolean, onDismiss: () => void, onRename: (val: string) => void, initialValue: string }) => {
    const theme = useTheme();
    const [localValue, setLocalValue] = useState(initialValue);
    useEffect(() => { if (visible) setLocalValue(initialValue); }, [visible, initialValue]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>Rename Post</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    placeholder="New Filename"
                    value={localValue}
                    onChangeText={setLocalValue}
                    mode="flat"
                    autoFocus
                    style={styles.dialogInput}
                    selectionColor={theme.colors.primary}
                    activeUnderlineColor={theme.colors.primary}
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button onPress={() => onRename(localValue)} disabled={!localValue} mode="contained" style={{ borderRadius: 20 }}>Rename</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

// Sub-component for New File Dialog
const NewFileDialog = ({ visible, onDismiss, onCreate }: { visible: boolean, onDismiss: () => void, onCreate: (val: string) => void }) => {
    const theme = useTheme();
    const [localValue, setLocalValue] = useState('');
    useEffect(() => { if (visible) setLocalValue(''); }, [visible]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>New Post</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    placeholder="Filename"
                    value={localValue}
                    onChangeText={setLocalValue}
                    mode="flat"
                    autoFocus
                    style={styles.dialogInput}
                    selectionColor={theme.colors.primary}
                    activeUnderlineColor={theme.colors.primary}
                />
                <Text variant="bodySmall" style={{ marginTop: 12, opacity: 0.6, marginLeft: 4 }}>.md will be added automatically</Text>
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button onPress={() => onCreate(localValue)} disabled={!localValue} mode="contained" style={{ borderRadius: 20 }}>Create</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

const FileItem = memo(({ item, onRename, onDelete, onPress }: { item: any, onRename: () => void, onDelete: () => void, onPress: () => void }) => {
    const theme = useTheme();
    const swipeableRef = useRef<Swipeable>(null);

    const renderRightActions = (progress: any, dragX: any) => {
        const trans = dragX.interpolate({
            inputRange: [-100, 0],
            outputRange: [1, 0],
            extrapolate: 'clamp',
        });
        return (
            <View style={styles.rightActionContainer}>
                <Animated.View style={{ flex: 1, transform: [{ scale: trans }] }}>
                    <RectButton style={[styles.actionButton, { backgroundColor: theme.colors.errorContainer }]} onPress={onDelete}>
                        <List.Icon icon="delete-outline" color={theme.colors.error} />
                    </RectButton>
                </Animated.View>
            </View>
        );
    };

    const renderLeftActions = (progress: any, dragX: any) => {
        const trans = dragX.interpolate({
            inputRange: [0, 100],
            outputRange: [0, 1],
            extrapolate: 'clamp',
        });
        return (
            <View style={styles.leftActionContainer}>
                <Animated.View style={{ flex: 1, transform: [{ scale: trans }] }}>
                    <RectButton style={[styles.actionButton, { backgroundColor: theme.colors.primaryContainer }]} onPress={onRename}>
                        <List.Icon icon="pencil-outline" color={theme.colors.primary} />
                    </RectButton>
                </Animated.View>
            </View>
        );
    };

    return (
        <Swipeable
            ref={swipeableRef}
            renderRightActions={renderRightActions}
            renderLeftActions={renderLeftActions}
            friction={1.8}
            rightThreshold={80}
            leftThreshold={80}
            containerStyle={styles.swipeableContainer}
            onSwipeableWillOpen={(direction) => {
                if (direction === 'left') {
                    onRename();
                } else {
                    onDelete();
                }
                swipeableRef.current?.close();
            }}
        >
            <TouchableRipple
                onPress={onPress}
                rippleColor="rgba(0,0,0,0.1)"
                style={styles.ripple}
            >
                <View style={styles.listItemWrapper}>
                    <List.Item
                        title={item.name}
                        titleStyle={styles.listItemTitle}
                        description={item.lastModified ? formatRelativeDate(item.lastModified) : 'Unknown date'}
                        descriptionStyle={styles.listItemSubtitle}
                        left={props => <List.Icon {...props} icon="file-document-outline" color={theme.colors.primary} />}
                        right={props => <List.Icon {...props} icon="chevron-right" color={theme.colors.outline} />}
                        style={[styles.listItem, { backgroundColor: theme.colors.background }]}
                    />
                </View>
            </TouchableRipple>
        </Swipeable>
    );
});

export default function Files() {
    const { config, updateRepoConfig, repoCache, setRepoFileCache } = useAppContext();
    const theme = useTheme();
    const router = useRouter();

    const repoPath = config.repo;
    const repoConfig = repoPath ? config.repoConfigs[repoPath] : null;

    const [files, setFiles] = useState<any[]>(repoPath ? (repoCache[repoPath] || []) : []);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const [isNewFileVisible, setIsNewFileVisible] = useState(false);
    const [isRenameVisible, setIsRenameVisible] = useState(false);
    const [isDeleteVisible, setIsDeleteVisible] = useState(false);
    const [selectedFile, setSelectedFile] = useState<any>(null);

    const [snackbarVisible, setSnackbarVisible] = useState(false);
    const [snackbarMsg, setSnackbarMsg] = useState('');

    const fetchFiles = useCallback(async (isManualRefresh = false) => {
        if (!repoPath || !repoConfig) return;

        const currentCache = repoCache[repoPath] || [];
        if (currentCache.length === 0 || isManualRefresh) {
            setIsLoading(true);
        }

        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            if (!token) throw new Error('Not authenticated');

            const filesResponse = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${repoConfig.contentDir}`, {
                headers: { Authorization: `token ${token}` }
            });

            if (Array.isArray(filesResponse.data)) {
                let mdFiles = filesResponse.data.filter((f: any) =>
                    f.type === 'file' && (f.name.endsWith('.md') || f.name.endsWith('.markdown'))
                );

                try {
                    const enrichedFiles = await Promise.all(mdFiles.map(async (file) => {
                        try {
                            const fileCommits = await axios.get(`https://api.github.com/repos/${repoPath}/commits`, {
                                headers: { Authorization: `token ${token}` },
                                params: { path: file.path, per_page: 1 }
                            });
                            return {
                                ...file,
                                lastModified: fileCommits.data[0]?.commit?.author?.date || null
                            };
                        } catch (e) {
                            return file;
                        }
                    }));

                    const hasChanged = enrichedFiles.length !== currentCache.length ||
                        (enrichedFiles.length > 0 && (enrichedFiles[0].sha !== currentCache[0]?.sha || enrichedFiles[0].lastModified !== currentCache[0]?.lastModified));

                    if (hasChanged) {
                        setFiles(enrichedFiles);
                        await setRepoFileCache(repoPath, enrichedFiles);
                        console.log('[Files] Cache updated');
                    }
                } catch (e) {
                    console.error('[Files] Commit fetch failed', e);
                    const hasChanged = mdFiles.length !== currentCache.length ||
                        (mdFiles.length > 0 && mdFiles[0].sha !== currentCache[0]?.sha);
                    if (hasChanged) {
                        setFiles(mdFiles);
                        await setRepoFileCache(repoPath, mdFiles);
                    }
                }
            } else {
                if (currentCache.length !== 0) {
                    setFiles([]);
                    await setRepoFileCache(repoPath, []);
                }
            }
            setError(null);
        } catch (e: any) {
            console.error('[Files] Fetch failed', e);
            if (e.response?.status === 404) {
                setError('Directory not found. Please check your site settings.');
            } else {
                setError(e.message || 'Failed to fetch files');
            }
        } finally {
            setIsLoading(false);
        }
    }, [repoPath, repoConfig, repoCache, setRepoFileCache]);

    useEffect(() => {
        if (repoPath) {
            setFiles(repoCache[repoPath] || []);
        } else {
            setFiles([]);
        }
    }, [repoPath, repoCache]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const handleCreateFile = async (name: string) => {
        if (!repoConfig) return;
        const cleanName = name.endsWith('.md') ? name : `${name}.md`;
        const path = `${repoConfig.contentDir}/${cleanName}`;
        setIsNewFileVisible(false);
        router.push(`/editor/${encodeURIComponent(path)}?new=true`);
    };

    const handleDeleteFile = async () => {
        if (!selectedFile || !repoPath) return;
        const originalFiles = [...files];
        setFiles(prev => prev.filter(f => f.sha !== selectedFile.sha));
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedFile.path}`, {
                headers: { Authorization: `token ${token}` },
                data: {
                    message: `Delete ${selectedFile.name}`,
                    sha: selectedFile.sha
                }
            });
            await setRepoFileCache(repoPath, files.filter(f => f.sha !== selectedFile.sha));
            setSnackbarMsg(`${selectedFile.name} deleted`);
            setSnackbarVisible(true);
        } catch (e: any) {
            setFiles(originalFiles);
            setSnackbarMsg(`Delete failed: ${e.message}`);
            setSnackbarVisible(true);
        } finally {
            setIsLoading(false);
            setIsDeleteVisible(false);
            setSelectedFile(null);
        }
    };

    const handleRenameFile = async (newName: string) => {
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
            const newPath = `${repoConfig.contentDir}/${cleanName}`;
            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, {
                message: `Rename ${selectedFile.name} to ${cleanName}`,
                content: response.data.content,
            }, {
                headers: { Authorization: `token ${token}` }
            });
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedFile.path}`, {
                headers: { Authorization: `token ${token}` },
                data: {
                    message: `Delete old file after rename`,
                    sha: selectedFile.sha
                }
            });
            // Immediately update local state and cache
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
    };

    const filteredFiles = files.filter(f =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header elevated={false} style={{ backgroundColor: theme.colors.background }}>
                <Appbar.BackAction onPress={() => {
                    if (router.canGoBack()) router.back();
                    else router.replace('/');
                }} />
                <Appbar.Content title="Posts" titleStyle={{ fontWeight: 'bold' }} />
                <Appbar.Action icon="image-multiple" onPress={() => router.push('/assets')} />
                <Appbar.Action icon="cog" onPress={() => router.push('/config')} />
                <Appbar.Action icon="refresh" onPress={() => fetchFiles(true)} disabled={isLoading} />
            </Appbar.Header>

            <View style={styles.content}>
                <View style={styles.searchContainer}>
                    <Searchbar
                        placeholder="Search posts..."
                        onChangeText={setSearchQuery}
                        value={searchQuery}
                        style={styles.searchbar}
                        inputStyle={styles.searchbarInput}
                        icon="filter-variant"
                        elevation={0}
                    />
                </View>

                <FlatList
                    data={filteredFiles}
                    keyExtractor={(item) => item.sha}
                    contentContainerStyle={{ paddingBottom: 100 }}
                    refreshControl={
                        <RefreshControl
                            refreshing={isLoading}
                            onRefresh={() => fetchFiles(true)}
                        />
                    }
                    renderItem={({ item }) => (
                        <FileItem
                            item={item}
                            onRename={() => {
                                setSelectedFile(item);
                                setIsRenameVisible(true);
                            }}
                            onDelete={() => {
                                setSelectedFile(item);
                                setIsDeleteVisible(true);
                            }}
                            onPress={() => {
                                router.push(`/editor/${encodeURIComponent(item.path)}`);
                            }}
                        />
                    )}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            {error ? (
                                <>
                                    <Avatar.Icon size={64} icon="alert-circle-outline" style={{ backgroundColor: 'transparent' }} color={theme.colors.error} />
                                    <Text variant="bodyLarge" style={{ color: theme.colors.error, marginTop: 16, textAlign: 'center' }}>
                                        {error}
                                    </Text>
                                    <Button mode="contained" onPress={() => router.push('/config')} style={{ marginTop: 24 }}>
                                        Configure Paths
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Avatar.Icon size={64} icon="file-search-outline" style={{ backgroundColor: 'transparent' }} color={theme.colors.outline} />
                                    <Text variant="bodyLarge" style={{ color: theme.colors.outline, marginTop: 16 }}>
                                        No posts found.
                                    </Text>
                                </>
                            )}
                        </View>
                    }
                />
            </View>

            <Portal>
                <NewFileDialog
                    visible={isNewFileVisible}
                    onDismiss={() => setIsNewFileVisible(false)}
                    onCreate={handleCreateFile}
                />

                <RenameDialog
                    visible={isRenameVisible}
                    onDismiss={() => setIsRenameVisible(false)}
                    onRename={handleRenameFile}
                    initialValue={selectedFile?.name?.replace('.md', '') || ''}
                />

                <Dialog visible={isDeleteVisible} onDismiss={() => setIsDeleteVisible(false)} style={{ borderRadius: 28 }}>
                    <Dialog.Title>Delete Post</Dialog.Title>
                    <Dialog.Content>
                        <Text>Are you sure you want to delete '{selectedFile?.name}'? This cannot be undone.</Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setIsDeleteVisible(false)}>Cancel</Button>
                        <Button onPress={handleDeleteFile} textColor={theme.colors.error}>Delete</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            <Snackbar
                visible={snackbarVisible}
                onDismiss={() => setSnackbarVisible(false)}
                duration={3000}
            >
                {snackbarMsg}
            </Snackbar>

            <FAB
                icon="plus"
                label="New Post"
                style={styles.fab}
                onPress={() => setIsNewFileVisible(true)}
            />
        </View>
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
