import axios from 'axios';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { memo, useCallback, useEffect, useState } from 'react';
import { Dimensions, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Appbar, Avatar, Button, Dialog, FAB, IconButton, Portal, Searchbar, Snackbar, Text, TextInput, useTheme } from 'react-native-paper';
import { useAppContext } from '../context/AppContext';

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 2;
const ITEM_SIZE = (width - 48) / COLUMN_COUNT;

// Helper to format relative dates (copied from files.tsx for consistency)
const formatRelativeDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return date.toLocaleDateString();
};

// Sub-component for Image Naming Dialog
const ImageNameDialog = ({ visible, onDismiss, onConfirm, initialValue }: { visible: boolean, onDismiss: () => void, onConfirm: (val: string) => void, initialValue: string }) => {
    const [localValue, setLocalValue] = useState(initialValue);
    useEffect(() => { if (visible) setLocalValue(initialValue); }, [visible, initialValue]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss}>
            <Dialog.Title>Upload Image</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    label="Filename"
                    value={localValue}
                    onChangeText={setLocalValue}
                    mode="outlined"
                    autoFocus
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button mode="contained" onPress={() => onConfirm(localValue)}>Upload</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

// Sub-component for Rename Dialog
const RenameDialog = ({ visible, onDismiss, onRename, initialValue }: { visible: boolean, onDismiss: () => void, onRename: (val: string) => void, initialValue: string }) => {
    const [localValue, setLocalValue] = useState(initialValue);
    useEffect(() => { if (visible) setLocalValue(initialValue); }, [visible, initialValue]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss}>
            <Dialog.Title>Rename Asset</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    label="New Name"
                    value={localValue}
                    onChangeText={setLocalValue}
                    mode="outlined"
                    autoFocus
                />
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button onPress={() => onRename(localValue)}>Rename</Button>
            </Dialog.Actions>
        </Dialog>
    );
};

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
                        icon="pencil"
                        iconColor="white"
                        size={20}
                        onPress={onRename}
                        style={{ backgroundColor: 'rgba(0,0,0,0.3)', margin: 2 }}
                    />
                    <IconButton
                        icon="delete"
                        iconColor={theme.colors.error}
                        size={20}
                        onPress={onDelete}
                        style={{ backgroundColor: 'rgba(255,255,255,0.8)', margin: 2 }}
                    />
                </View>
            </View>
            <View style={{ backgroundColor: theme.colors.surface, padding: 4 }}>
                <Text variant="bodySmall" numberOfLines={1} style={styles.assetName}>{item.name}</Text>
            </View>
        </View>
    );
});

export default function Assets() {
    const { config, assetCache, setRepoAssetCache } = useAppContext();
    const theme = useTheme();
    const router = useRouter();

    const repoPath = config.repo;
    const repoConfig = repoPath ? config.repoConfigs[repoPath] : null;

    const [assets, setAssets] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [githubToken, setGithubToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Dialog & UI state
    const [selectedAsset, setSelectedAsset] = useState<any>(null);
    const [isRenameVisible, setIsRenameVisible] = useState(false);
    const [isDeleteVisible, setIsDeleteVisible] = useState(false);
    const [isImageNameVisible, setIsImageNameVisible] = useState(false);
    const [pendingImage, setPendingImage] = useState<any>(null);
    const [snackbarVisible, setSnackbarVisible] = useState(false);
    const [snackbarMsg, setSnackbarMsg] = useState('');

    useEffect(() => {
        SecureStore.getItemAsync('github_access_token').then(setGithubToken);
    }, []);

    const fetchAssets = useCallback(async (silent = false) => {
        if (!repoPath || !repoConfig) {
            setError('No repository configured.');
            return;
        }

        if (!silent) setIsLoading(true);
        setError(null);

        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const cleanAssetsDir = repoConfig.assetsDir.replace(/^\/+/, '').replace(/\/+/g, '/');

            const response = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${cleanAssetsDir}`, {
                headers: { Authorization: `token ${token}` }
            });

            if (Array.isArray(response.data)) {
                const imageFiles = response.data.filter((f: any) =>
                    f.type === 'file' && f.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)
                );
                // Also fetch commit info for dates if possible, or just use response
                await setRepoAssetCache(repoPath, imageFiles);
            } else {
                setError('No assets folder found at the configured path.');
            }
        } catch (e: any) {
            console.error('[Assets] Fetch failed:', e.response?.data || e.message);
            if (e.response?.status === 404) {
                setError(`Assets directory "${repoConfig.assetsDir}" not found.`);
            } else {
                setError('Failed to fetch assets from GitHub.');
            }
        } finally {
            setIsLoading(false);
        }
    }, [repoPath, repoConfig?.assetsDir, setRepoAssetCache]);

    useEffect(() => {
        if (repoPath && assetCache[repoPath]) {
            setAssets(assetCache[repoPath]);
        }
    }, [repoPath, assetCache]);

    useEffect(() => {
        if (repoPath) fetchAssets();
    }, [repoPath, repoConfig?.assetsDir]); // Fetch when repo or assets dir changes

    const handleDeleteAsset = async () => {
        if (!selectedAsset || !repoPath) return;
        const originalAssets = [...assets];
        // Filter by path to be more precise than sha
        setAssets(prev => prev.filter(f => f.path !== selectedAsset.path));
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedAsset.path}`, {
                headers: { Authorization: `token ${token}` },
                data: {
                    message: `Delete asset ${selectedAsset.name}`,
                    sha: selectedAsset.sha
                }
            });
            await setRepoAssetCache(repoPath, assets.filter(f => f.path !== selectedAsset.path));
            setSnackbarMsg(`${selectedAsset.name} deleted`);
            setSnackbarVisible(true);
        } catch (e: any) {
            setAssets(originalAssets);
            const errorMsg = e.response?.data?.message || e.message;
            setSnackbarMsg(`Delete failed: ${errorMsg}`);
            setSnackbarVisible(true);
            console.error('[Assets] Delete failed:', e.response?.data || e.message);
        } finally {
            setIsLoading(false);
            setIsDeleteVisible(false);
            setSelectedAsset(null);
        }
    };

    const handleRenameAsset = async (newName: string) => {
        if (!selectedAsset || !newName || !repoPath || !repoConfig) return;

        // Keep original extension if not provided
        const ext = selectedAsset.name.split('.').pop();
        const cleanName = newName.includes('.') ? newName : `${newName}.${ext}`;
        const newPath = `${repoConfig.assetsDir}/${cleanName}`.replace(/^\/+/, '').replace(/\/+/g, '/');

        setIsLoading(true);
        setIsRenameVisible(false);

        try {
            const token = await SecureStore.getItemAsync('github_access_token');

            // GitHub doesn't have a "rename" API for single files. 
            // We have to: 1. Get content, 2. Create new file, 3. Delete old file.
            // But if we have the download_url, we can fetch it or get content via API.
            const contentResponse = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${selectedAsset.path}`, {
                headers: { Authorization: `token ${token}` }
            });

            // 1. Create new file
            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, {
                message: `Rename ${selectedAsset.name} to ${cleanName}`,
                content: contentResponse.data.content,
                sha: undefined // New file
            }, {
                headers: { Authorization: `token ${token}` }
            });

            // 2. Delete old file
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedAsset.path}`, {
                headers: { Authorization: `token ${token}` },
                data: {
                    message: `Cleanup after rename ${selectedAsset.name} to ${cleanName}`,
                    sha: selectedAsset.sha
                }
            });

            const updatedAssets = assets.map(a =>
                a.path === selectedAsset.path ? { ...a, name: cleanName, path: newPath } : a
            );
            await setRepoAssetCache(repoPath, updatedAssets);
            setSnackbarMsg(`${selectedAsset.name} renamed to ${cleanName}`);
            setSnackbarVisible(true);
        } catch (e: any) {
            console.error('[Assets] Rename failed:', e.response?.data || e.message);
            setSnackbarMsg('Rename failed. Check your connection or permissions.');
            setSnackbarVisible(true);
        } finally {
            setIsLoading(false);
            setSelectedAsset(null);
        }
    };

    const pickImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            quality: 0.8,
        });

        if (!result.canceled) {
            const uri = result.assets[0].uri;
            const filename = uri.split('/').pop() || `img_${Date.now()}.jpg`;
            setPendingImage({ uri, filename });
            setIsImageNameVisible(true);
        }
    };

    const confirmUpload = async (filename: string) => {
        if (!pendingImage || !repoPath || !repoConfig) return;
        setIsImageNameVisible(false);
        setIsLoading(true);

        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const cleanAssetsDir = repoConfig.assetsDir.replace(/^\/+/, '').replace(/\/+/g, '/');
            const newPath = `${cleanAssetsDir}/${filename}`;

            // Resize/Compress
            const manipResult = await ImageManipulator.manipulateAsync(
                pendingImage.uri,
                [{ resize: { width: 1200 } }],
                { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
            );

            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, {
                message: `Upload asset ${filename}`,
                content: manipResult.base64,
            }, {
                headers: { Authorization: `token ${token}` }
            });

            setSnackbarMsg(`Uploaded ${filename}`);
            setSnackbarVisible(true);
            fetchAssets(true);
        } catch (e: any) {
            console.error('[Assets] Upload failed', e.response?.data || e.message);
            setSnackbarMsg(`Upload failed: ${e.message}`);
            setSnackbarVisible(true);
        } finally {
            setIsLoading(false);
            setPendingImage(null);
        }
    };

    const filteredAssets = assets.filter(item =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const headers = githubToken ? { Authorization: `token ${githubToken}` } : undefined;

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header elevated={false} style={{ backgroundColor: theme.colors.background }}>
                <Appbar.BackAction onPress={() => router.back()} />
                <Appbar.Content title="Asset Manager" titleStyle={{ fontSize: 18, fontWeight: 'bold', opacity: 0.8 }} />
                <Appbar.Action icon="refresh" onPress={() => fetchAssets()} disabled={isLoading} />
            </Appbar.Header>

            <View style={styles.searchContainer}>
                <Searchbar
                    placeholder="Search assets..."
                    onChangeText={setSearchQuery}
                    value={searchQuery}
                    style={styles.searchbar}
                    inputStyle={{ fontSize: 15 }}
                    iconColor={theme.colors.primary}
                />
            </View>

            <View style={styles.content}>
                <FlatList
                    data={filteredAssets}
                    keyExtractor={(item) => item.path}
                    numColumns={COLUMN_COUNT}
                    contentContainerStyle={styles.grid}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={isLoading} onRefresh={fetchAssets} />
                    }
                    renderItem={({ item }) => (
                        <AssetItem
                            item={item}
                            headers={headers}
                            onRename={() => {
                                setSelectedAsset(item);
                                setIsRenameVisible(true);
                            }}
                            onDelete={() => {
                                setSelectedAsset(item);
                                setIsDeleteVisible(true);
                            }}
                        />
                    )}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Avatar.Icon size={64} icon="image-off-outline" style={{ backgroundColor: 'transparent' }} color={theme.colors.outline} />
                            <Text variant="bodyLarge" style={{ color: theme.colors.outline, marginTop: 16 }}>
                                {error || 'No assets found.'}
                            </Text>
                        </View>
                    }
                />
            </View>

            <Portal>
                <ImageNameDialog
                    visible={isImageNameVisible}
                    onDismiss={() => setIsImageNameVisible(false)}
                    onConfirm={confirmUpload}
                    initialValue={pendingImage?.filename || ''}
                />

                <RenameDialog
                    visible={isRenameVisible}
                    onDismiss={() => setIsRenameVisible(false)}
                    onRename={handleRenameAsset}
                    initialValue={selectedAsset?.name.split('.')[0] || ''}
                />

                <Dialog visible={isDeleteVisible} onDismiss={() => setIsDeleteVisible(false)} style={{ borderRadius: 28 }}>
                    <Dialog.Title>Delete Asset</Dialog.Title>
                    <Dialog.Content>
                        <Text>Are you sure you want to delete '{selectedAsset?.name}'? This will break any posts using this image.</Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setIsDeleteVisible(false)}>Cancel</Button>
                        <Button onPress={handleDeleteAsset} textColor={theme.colors.error}>Delete</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            <FAB
                icon="plus"
                style={styles.fab}
                onPress={pickImage}
                label="Upload Image"
            />

            <Snackbar
                visible={snackbarVisible}
                onDismiss={() => setSnackbarVisible(false)}
                duration={3000}
            >
                {snackbarMsg}
            </Snackbar>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    searchContainer: { padding: 16, paddingBottom: 8 },
    searchbar: { elevation: 0, backgroundColor: 'transparent', borderBottomWidth: 1, borderBottomColor: '#eee' },
    content: { flex: 1, paddingHorizontal: 16 },
    grid: { paddingBottom: 24 },
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
    assetName: { fontSize: 12, padding: 8, paddingBottom: 4 },
    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
    fab: {
        position: 'absolute',
        margin: 16,
        right: 16,
        bottom: 16,
        borderRadius: 16,
        paddingHorizontal: 8,
        elevation: 4,
    },
});
