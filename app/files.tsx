import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Buffer } from 'buffer';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as ExpoSplashScreen from 'expo-splash-screen';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Dimensions, FlatList, Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Avatar, Button, Dialog, FAB, IconButton, Portal, Searchbar, SegmentedButtons, Surface, Text, TextInput, TouchableRipple, useTheme } from 'react-native-paper';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Draft, useAppContext } from '../context/AppContext';

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 2;
const ASSET_SPACING = 12;
const ASSET_CONTAINER_PADDING = 16;
const ASSET_ITEM_WIDTH = (width - (ASSET_CONTAINER_PADDING * 2) - ASSET_SPACING) / COLUMN_COUNT;

// Enable LayoutAnimation on Android


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
    const theme = useTheme();
    const [localValue, setLocalValue] = useState(initialValue);

    useEffect(() => {
        if (visible) {
            setLocalValue(initialValue);
        }
    }, [visible, initialValue]);

    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>New Asset</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    label="Filename"
                    value={localValue}
                    onChangeText={setLocalValue}
                    mode="flat"
                    autoFocus
                    style={{ backgroundColor: theme.colors.surfaceVariant }}
                    right={extension ? <TextInput.Affix text={'.' + extension} /> : null}
                />
                {size ? (
                    <Text variant="bodySmall" style={{ marginTop: 8, opacity: 0.6, textAlign: 'right' }}>
                        File size: {formatBytes(size)}
                    </Text>
                ) : null}
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

// Sub-component for New Draft Dialog
const NewDraftDialog = ({ visible, onDismiss, onCreate, title, repoPath, repoConfig }: { visible: boolean, onDismiss: () => void, onCreate: (title: string, dir: string) => void, title: string, repoPath: string | null, repoConfig: any }) => {
    const theme = useTheme();
    const [localTitle, setLocalTitle] = useState('');
    const [selectedDir, setSelectedDir] = useState('');
    const [dirs, setDirs] = useState<string[]>([]);
    const [isLoadingDirs, setIsLoadingDirs] = useState(false);

    useEffect(() => {
        if (visible) {
            setLocalTitle('');
            setSelectedDir('');
            if (repoPath && repoConfig) fetchDirs();
        }
    }, [visible, repoPath, repoConfig]);

    const fetchDirs = async () => {
        setIsLoadingDirs(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const res = await axios.get(`https://api.github.com/repos/${repoPath}/git/trees/HEAD?recursive=1`, {
                headers: { Authorization: `token ${token}` }
            });
            const contentDirNode = repoConfig.contentDir.replace(/\/+$/, '');
            const paths = res.data.tree
                .filter((node: any) => node.type === 'tree' && node.path.startsWith(contentDirNode + '/'))
                .map((node: any) => node.path.substring(contentDirNode.length + 1));
            setDirs(['', ...paths]);
        } catch (e) {
            console.error('Failed to fetch dirs', e);
            setDirs(['']);
        } finally {
            setIsLoadingDirs(false);
        }
    };

    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28, maxHeight: Dimensions.get('window').height * 0.8 }}>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Content>
                <TextInput
                    placeholder="Draft Title"
                    value={localTitle}
                    onChangeText={setLocalTitle}
                    mode="flat"
                    autoFocus
                    style={[styles.dialogInput, { backgroundColor: theme.colors.surfaceVariant, marginBottom: 16 }]}
                    selectionColor={theme.colors.primary}
                    activeUnderlineColor={theme.colors.primary}
                />
                <Text variant="labelMedium" style={{ marginBottom: 8, color: theme.colors.outline }}>Select Directory</Text>
                {isLoadingDirs ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} style={{ margin: 16 }} />
                ) : (
                    <View style={{ maxHeight: 150, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.colors.surfaceVariant }}>
                        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                            {dirs.map((d, i) => (
                                <TouchableRipple key={i} onPress={() => setSelectedDir(d)} style={{ padding: 12, backgroundColor: selectedDir === d ? theme.colors.primaryContainer : 'transparent' }}>
                                    <Text style={{ color: selectedDir === d ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}>
                                        {d === '' ? 'Root (Content Directory)' : d}
                                    </Text>
                                </TouchableRipple>
                            ))}
                        </ScrollView>
                    </View>
                )}
            </Dialog.Content>
            <Dialog.Actions>
                <Button onPress={onDismiss}>Cancel</Button>
                <Button onPress={() => onCreate(localTitle, selectedDir)} disabled={!localTitle} mode="contained" style={{ borderRadius: 20 }}>Create</Button>
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
            setCommitMsg(`add!(content): created ${initialTitle}`);
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

const AssetTypeDialog = ({ visible, onDismiss, onSelect }: { visible: boolean, onDismiss: () => void, onSelect: (type: 'image' | 'video' | 'file') => void }) => {
    return (
        <Dialog visible={visible} onDismiss={onDismiss} style={{ borderRadius: 28 }}>
            <Dialog.Title>New Asset</Dialog.Title>
            <Dialog.Content>
                <Text variant="bodyMedium" style={{ marginBottom: 16 }}>Choose the type of asset you want to upload:</Text>
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

// Sub-component for Asset Item

const AssetItem = memo(({ item, headers, onRename, onDelete }: { item: any, headers: any, onRename: () => void, onDelete: () => void }) => {
    const theme = useTheme();
    const [aspectRatio, setAspectRatio] = useState<number>(1); // Default to square until loaded

    const isImage = item.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
    const icon = getAssetIcon(item.name);

    return (
        <View style={[styles.assetCard, { backgroundColor: theme.colors.surfaceVariant }]} >
            <View style={styles.assetThumbContainer}>
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
                    <View style={styles.assetIconPlaceholder}>
                        <MaterialCommunityIcons name={icon as any} size={48} color={theme.colors.onSurfaceVariant} />
                    </View>
                )}
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
const DraftItem = memo(({ item, onPress, onDelete, onPublish, onRename }: { item: any, onPress: () => void, onDelete: () => void, onPublish: () => void, onRename: () => void }) => {
    const theme = useTheme();
    return (
        <Surface elevation={1} style={{ borderRadius: 16, overflow: 'hidden', marginVertical: 4, marginHorizontal: 0, backgroundColor: theme.colors.surface }}>
            <TouchableRipple onPress={onPress} style={{ flex: 1 }} rippleColor={theme.colors.onSurfaceVariant + '1F'} borderless={true}>
                <View style={[styles.draftCard, { backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0, flexDirection: 'row', alignItems: 'center' }]}>
                    <MaterialCommunityIcons name="file-document-edit-outline" size={24} color={theme.colors.primary} style={{ marginRight: 16 }} />
                    <View style={{ flex: 1 }}>
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
                <View style={[styles.draftCard, { backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0, flexDirection: 'row', alignItems: 'center' }]}>
                    <MaterialCommunityIcons name="file-document-outline" size={24} color={theme.colors.outline} style={{ marginRight: 16 }} />
                    <View style={{ flex: 1 }}>
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
                </View>
            </TouchableRipple>
        </Surface>
    );
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
            <View style={{ padding: 16, height: 76, flexDirection: 'row', alignItems: 'center' }}>
                <Animated.View style={[animatedStyle, { width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.onSurfaceVariant, marginRight: 16 }]} />
                <View style={{ flex: 1, justifyContent: 'center' }}>
                    <Animated.View style={[animatedStyle, { height: 18, width: '70%', backgroundColor: theme.colors.onSurfaceVariant, borderRadius: 4, marginBottom: 8 }]} />
                    <Animated.View style={[animatedStyle, { height: 12, width: '30%', backgroundColor: theme.colors.onSurfaceVariant, borderRadius: 4 }]} />
                </View>
            </View>
        </Surface>
    );
});

const ListingSkeleton = memo(({ isGrid }: { isGrid?: boolean }) => {
    const items = Array.from({ length: isGrid ? 16 : 12 });
    if (isGrid) {
        return (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: ASSET_CONTAINER_PADDING }}>
                <View style={{ width: ASSET_ITEM_WIDTH }}>
                    {Array.from({ length: 6 }).map((_, i) => <SkeletonItem key={i} isGrid />)}
                </View>
                <View style={{ width: ASSET_ITEM_WIDTH }}>
                    {Array.from({ length: 6 }).map((_, i) => <SkeletonItem key={i * 2 + 1} isGrid />)}
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

// Sub-component for Directory Item
const DirItem = memo(({ item, onPress, onRename, onDelete }: { item: any, onPress: () => void, onRename?: () => void, onDelete?: () => void }) => {
    const theme = useTheme();
    return (
        <Surface elevation={1} style={{ borderRadius: 16, overflow: 'hidden', marginVertical: 4, marginHorizontal: 0, backgroundColor: theme.colors.surfaceVariant }}>
            <TouchableRipple onPress={onPress} style={{ flex: 1 }} rippleColor={theme.colors.onSurfaceVariant + '1F'} borderless={true}>
                <View style={[styles.draftCard, { backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0, flexDirection: 'row', alignItems: 'center' }]}>
                    <MaterialCommunityIcons
                        name="folder"
                        size={24}
                        color={theme.colors.primary}
                        style={{ marginRight: 16 }}
                    />
                    <View style={{ flex: 1 }}>
                        <View style={styles.draftHeader}>
                            <Text variant="titleMedium" numberOfLines={1} style={[styles.draftTitle, { color: theme.colors.onSurface }]}>
                                {item.name}
                            </Text>
                            <View style={{ flexDirection: 'row', gap: 4 }}>
                                {onRename && (
                                    <IconButton
                                        mode="contained-tonal"
                                        icon="cursor-text"
                                        size={18}
                                        iconColor={theme.colors.primary}
                                        containerColor={theme.colors.surface}
                                        onPress={onRename}
                                    />
                                )}
                                {onDelete && (
                                    <IconButton
                                        mode="contained-tonal"
                                        icon="delete-outline"
                                        size={18}
                                        iconColor={theme.colors.error}
                                        containerColor={theme.colors.surface}
                                        onPress={onDelete}
                                    />
                                )}
                            </View>
                        </View>
                    </View>
                </View>
            </TouchableRipple>
        </Surface>
    );
});


export default function Files() {
    const { config, repoCache, setRepoFileCache, assetCache, setRepoAssetCache, localDrafts, saveDraft, deleteDraft, showToast } = useAppContext();
    const theme = useTheme();
    const router = useRouter();
    const { notice } = useLocalSearchParams();

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
    const [hasLoadedPosts, setHasLoadedPosts] = useState(false);
    const [hasLoadedAssets, setHasLoadedAssets] = useState(false);

    const [isNewFileVisible, setIsNewFileVisible] = useState(false);
    const [isNewDraftVisible, setIsNewDraftVisible] = useState(false);
    const [isRenameVisible, setIsRenameVisible] = useState(false);
    const [isDeleteVisible, setIsDeleteVisible] = useState(false);
    const [selectedFile, setSelectedFile] = useState<any>(null);

    const [isImageNameVisible, setIsImageNameVisible] = useState(false);
    const [pickedAssetType, setPickedAssetType] = useState<'image' | 'video' | 'file'>('image');
    const [isAssetTypeVisible, setIsAssetTypeVisible] = useState(false);
    const [lastPickedUri, setLastPickedUri] = useState<string | null>(null);
    const [pickedFilename, setPickedFilename] = useState('');
    const [pickedAssetExtension, setPickedAssetExtension] = useState('');
    const [pickedAssetSize, setPickedAssetSize] = useState<number | undefined>();
    const [isUploading, setIsUploading] = useState(false);
    const [pendingImage, setPendingImage] = useState<any>(null); // Keep for some logic if needed

    const [isPublishDialogVisible, setIsPublishDialogVisible] = useState(false);
    const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
    const [isDeleteDraftVisible, setIsDeleteDraftVisible] = useState(false);
    const [isRenameDraftVisible, setIsRenameDraftVisible] = useState(false);

    const [isRenameAssetVisible, setIsRenameAssetVisible] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState<any>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [tombstones, setTombstones] = useState<Set<string>>(new Set());
    const activePathRef = useRef<string | null>(null);
    const activeAssetPathRef = useRef<string | null>(null);

    useEffect(() => {
        SecureStore.getItemAsync('github_access_token').then(setGithubToken);
    }, []);

    const fetchRecursive = async (path: string, token: string | null): Promise<any[]> => {
        try {
            const res = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${path}`, {
                headers: { Authorization: `token ${token}` }
            });
            let all: any[] = [];
            for (const item of res.data) {
                all.push(item);
                if (item.type === 'dir') {
                    const sub = await fetchRecursive(item.path, token);
                    all = all.concat(sub);
                }
            }
            return all;
        } catch (e) {
            console.error('[Files] Recursive fetch failed', e);
            return [];
        }
    };

    useEffect(() => {
        if (notice === 'no_changes') {
            // Clear the notice param by replacing the current route without it
            router.replace('/files');
        }
    }, [notice, router]);

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

        // Build the full path: contentDir + currentDir
        const requestedPath = currentDir
            ? `${repoConfig.contentDir}/${currentDir}`.replace(/\/+/g, '/')
            : repoConfig.contentDir;

        activePathRef.current = requestedPath;

        if (isManualRefresh) {
            setIsRefreshing(true);
            setTombstones(new Set());
            // Clear all local autosaves related to this repo to force fresh fetch
            const allKeys = await AsyncStorage.getAllKeys();
            const repoAutosaves = allKeys.filter((k: string) => k.startsWith('flux_draft_') && k.includes(encodeURIComponent(repoConfig.contentDir)));
            if (repoAutosaves.length > 0) await AsyncStorage.multiRemove(repoAutosaves);
        } else {
            setIsLoading(true);
        }
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const filesResponse = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${requestedPath}`, {
                headers: {
                    Authorization: `token ${token}`,
                    'Cache-Control': 'no-cache'
                }
            });

            // If path has changed since request started, ignore result
            if (activePathRef.current !== requestedPath) return;

            if (Array.isArray(filesResponse.data)) {
                // Get directories
                const dirs = filesResponse.data.filter((f: any) => f.type === 'dir').map((d: any) => ({ ...d, _isDir: true }));
                // Get all files (including hidden and non-markdown)
                let allFiles = filesResponse.data.filter((f: any) => f.type === 'file');

                // Fetch commit dates in parallel to show "last modified"
                allFiles = await Promise.all(allFiles.map(async (file: any) => {
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
                const combined = [...dirs, ...allFiles];
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
            setIsRefreshing(false);
            setHasLoadedPosts(true);
            ExpoSplashScreen.hideAsync();
        }
    }, [repoPath, repoConfig, setRepoFileCache, currentDir]);

    const fetchAssets = useCallback(async (isManualRefresh = false) => {
        if (!repoPath || !repoConfig) return;

        const cleanStatic = repoConfig.useStaticFolder !== false ? (repoConfig.staticDir?.replace(/^\/+|\/+$/g, '') || '') : '';
        const cleanAssets = repoConfig.assetsDir?.replace(/^\/+|\/+$/g, '') || '';
        const requestedPath = [cleanStatic, cleanAssets].filter(Boolean).join('/');

        activeAssetPathRef.current = requestedPath;

        if (isManualRefresh) {
            setIsRefreshing(true);
            setTombstones(new Set());
        } else {
            setIsLoading(true);
        }
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const response = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${requestedPath}`, {
                headers: {
                    Authorization: `token ${token}`,
                    'Cache-Control': 'no-cache'
                }
            });

            if (activeAssetPathRef.current !== requestedPath) return;

            if (Array.isArray(response.data)) {
                const allFiles = response.data.filter((f: any) => f.type === 'file');
                setAssets(allFiles);
                await setRepoAssetCache(repoPath, allFiles);
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
            setIsRefreshing(false);
            setHasLoadedAssets(true);
            ExpoSplashScreen.hideAsync();
        }
    }, [repoPath, repoConfig?.useStaticFolder, repoConfig?.staticDir, repoConfig?.assetsDir, setRepoAssetCache]);

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
            // Publish to draft's saved directory, fallback to current context, or root
            const draftDir = selectedDraft.dirPath !== undefined
                ? `${repoConfig.contentDir}/${selectedDraft.dirPath}`.replace(/\/+/g, '/').replace(/\/$/, '')
                : (currentDir ? `${repoConfig.contentDir}/${currentDir}` : repoConfig.contentDir).replace(/\/+/g, '/');

            const cleanPostPath = `${draftDir}/${extFilename}`.replace(/^\/+/, '').replace(/\/+/g, '/');

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
            showToast('Post published successfully', 'success');
        } catch (e: any) {
            console.error('[Files] Publish failed', e);
            showToast(`Publish failed: ${e.message}`, 'error');
        } finally {
            setIsLoading(false);
            setSelectedDraft(null);
        }
    }, [selectedDraft, repoPath, repoConfig, deleteDraft, fetchFiles, currentDir, showToast]);

    const handleAction = useCallback(() => {
        if (mode === 'posts') setIsNewFileVisible(true);
        else if (mode === 'drafts') setIsNewDraftVisible(true);
        else if (mode === 'assets') setIsAssetTypeVisible(true);
    }, [mode]);

    const handleCreateDraft = useCallback(async (title: string, dirPath: string) => {
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
            repoPath: repoPath || '',
            dirPath: dirPath || ''
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
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        if (!selectedFile || !repoPath) return;
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');

            if (selectedFile._isDir) {
                const allItems = await fetchRecursive(selectedFile.path, token);
                const filesToDelete = allItems.filter(item => item.type === 'file');

                for (const file of filesToDelete) {
                    await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${file.path}`, {
                        headers: { Authorization: `token ${token}` },
                        data: { message: `fix!(content): deleted ${file.path} (recursive)`, sha: file.sha }
                    });
                }
            } else {
                await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedFile.path}`, {
                    headers: { Authorization: `token ${token}` },
                    data: { message: `fix!(content): deleted ${selectedFile.name}`, sha: selectedFile.sha }
                });
            }

            setTombstones(prev => new Set(prev).add(selectedFile.path));
            const updated = files.filter(f => f.path !== selectedFile.path);
            setFiles(updated);
            await setRepoFileCache(repoPath, updated);
            showToast(`${selectedFile.name} deleted`, 'success');

            // Auto-remove empty parent directory (only for files)
            if (!selectedFile._isDir) {
                const parentDir = selectedFile.path.substring(0, selectedFile.path.lastIndexOf('/'));
                if (parentDir) {
                    try {
                        const parentRes = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${parentDir}`, {
                            headers: { Authorization: `token ${token}`, 'Cache-Control': 'no-cache' }
                        });
                        if (parentRes.status === 200 && Array.isArray(parentRes.data) && parentRes.data.length === 0) {
                            const checkPath = parentDir.split('/');
                            checkPath.pop();
                            setCurrentDir(checkPath.join('/'));
                        } else if (Array.isArray(parentRes.data) && parentRes.data.length === 1 && parentRes.data[0].name === '.gitkeep') {
                            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${parentRes.data[0].path}`, {
                                headers: { Authorization: `token ${token}` },
                                data: { message: `fix!(content): removed empty directory ${parentDir}`, sha: parentRes.data[0].sha }
                            });
                            // Remove the directory from the file list if we're viewing its parent
                            const dirName = parentDir.split('/').pop();
                            setFiles(prev => prev.filter(f => f.name !== dirName));
                        }
                    } catch (e) {
                        // Ignore parent dir cleanup errors
                    }
                }
            }
        } catch (e: any) {
            console.error('[Files] Delete failed', e);
            showToast(`Delete failed: ${e.message}`, 'error');
        } finally {
            setIsLoading(false);
            setIsDeleteVisible(false);
            setSelectedFile(null);
        }
    }, [selectedFile, repoPath, files, setRepoFileCache, showToast, fetchRecursive]);

    const handleRenameDraft = async (newTitle: string) => {
        if (!selectedDraft || !newTitle) return;
        await saveDraft({
            ...selectedDraft,
            title: newTitle,
            lastModified: new Date().toISOString()
        });
        setIsRenameDraftVisible(false);
        setSelectedDraft(null);
        showToast(`Renamed draft to ${newTitle}`, 'success');
    };

    const handleRenameDir = useCallback(async (newName: string) => {
        if (!selectedFile || !newName || !repoPath || !repoConfig) return;
        if (newName === selectedFile.name) {
            setIsRenameVisible(false);
            return;
        }

        const oldFile = { ...selectedFile };
        const previousFiles = [...files];
        const oldDirPath = oldFile.path.replace(/^\/+|\/+$/g, '');
        const parentPath = oldDirPath.includes('/') ? oldDirPath.substring(0, oldDirPath.lastIndexOf('/')) : '';
        const newDirPath = parentPath ? `${parentPath}/${newName}`.replace(/\/+/g, '/') : newName;

        // Optimistically update UI
        const optimisticFiles = files.map(f => (f.path === oldFile.path) ? { ...f, name: newName, path: newDirPath } : f);
        setFiles(optimisticFiles);
        setIsRenameVisible(false);

        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            // 1. Get Repo info for default branch
            const repoRes = await axios.get(`https://api.github.com/repos/${repoPath}`, {
                headers: { Authorization: `token ${token}` }
            });
            const branch = repoRes.data.default_branch;

            // 2. Get HEAD commit
            const branchRes = await axios.get(`https://api.github.com/repos/${repoPath}/branches/${branch}`, {
                headers: { Authorization: `token ${token}` }
            });
            const parentCommitSha = branchRes.data.commit.sha;
            const rootTreeSha = branchRes.data.commit.commit.tree.sha;

            // 3. Create a new tree based on the head commit's tree
            const createTreeRes = await axios.post(`https://api.github.com/repos/${repoPath}/git/trees`, {
                base_tree: rootTreeSha,
                tree: [
                    {
                        path: oldDirPath,
                        mode: '040000',
                        type: 'tree',
                        sha: null // Deletes the old directory tree
                    },
                    {
                        path: newDirPath,
                        mode: '040000',
                        type: 'tree',
                        sha: oldFile.sha // Re-links the same directory tree at the new path
                    }
                ]
            }, { headers: { Authorization: `token ${token}` } });

            // 4. Create commit
            const createCommitRes = await axios.post(`https://api.github.com/repos/${repoPath}/git/commits`, {
                message: `fix!(content): renamed directory ${oldFile.name} to ${newName}`,
                tree: createTreeRes.data.sha,
                parents: [parentCommitSha]
            }, { headers: { Authorization: `token ${token}` } });

            // 5. Update ref
            await axios.patch(`https://api.github.com/repos/${repoPath}/git/refs/heads/${branch}`, {
                sha: createCommitRes.data.sha
            }, { headers: { Authorization: `token ${token}` } });

            await setRepoFileCache(repoPath, optimisticFiles);
            showToast(`Renamed directory to ${newName}`, 'success');
        } catch (e: any) {
            console.error('[Files] Rename dir failed', e.response?.data || e.message);
            // Revert on failure
            setFiles(previousFiles);
            showToast(`Rename failed: ${e.response?.data?.message || e.message}`, 'error');
        } finally {
            setSelectedFile(null);
        }
    }, [selectedFile, repoPath, repoConfig, files, setRepoFileCache, showToast]);

    const handleRenameFile = useCallback(async (newName: string) => {
        if (!selectedFile || !newName || !repoPath || !repoConfig) return;

        if (selectedFile._isDir) {
            return handleRenameDir(newName);
        }

        // Preserve the original extension if the user doesn't provide one
        const originalExt = selectedFile.name.includes('.') ? selectedFile.name.substring(selectedFile.name.lastIndexOf('.')) : '';
        const cleanName = newName.includes('.') ? newName : `${newName}${originalExt}`;
        if (cleanName === selectedFile.name) {
            setIsRenameVisible(false);
            return;
        }

        const oldFile = { ...selectedFile };
        const previousFiles = [...files];
        const parentDir = oldFile.path.includes('/') ? oldFile.path.substring(0, oldFile.path.lastIndexOf('/')) : '';
        const newPath = parentDir ? `${parentDir}/${cleanName}`.replace(/\/+/g, '/') : cleanName;

        // Optimistically update UI
        const optimisticFiles = files.map(f => f.sha === oldFile.sha ? { ...f, name: cleanName, path: newPath } : f);
        setFiles(optimisticFiles);
        setIsRenameVisible(false);

        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const response = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${oldFile.path}`, {
                headers: { Authorization: `token ${token}` }
            });

            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, {
                message: `fix!(content): renamed ${oldFile.name} to ${cleanName}`,
                content: response.data.content,
            }, { headers: { Authorization: `token ${token}` } });

            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${oldFile.path}`, {
                headers: { Authorization: `token ${token}` },
                data: { message: `fix!(content): deleted old file after rename`, sha: oldFile.sha }
            });

            await setRepoFileCache(repoPath, optimisticFiles);
            showToast(`Renamed to ${cleanName}`, 'success');
        } catch (e: any) {
            console.error('[Files] Rename file failed', e);
            // Revert on failure
            setFiles(previousFiles);
            showToast(`Rename failed: ${e.message}`, 'error');
        } finally {
            setSelectedFile(null);
        }
    }, [selectedFile, repoPath, repoConfig, files, setRepoFileCache, handleRenameDir, showToast]);

    const handleDeleteAsset = useCallback(async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        if (!selectedAsset || !repoPath) return;
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${selectedAsset.path}`, {
                headers: { Authorization: `token ${token}` },
                data: { message: `fix!(assets): deleted ${selectedAsset.name}`, sha: selectedAsset.sha }
            });
            setTombstones(prev => new Set(prev).add(selectedAsset.path));
            const updated = assets.filter(f => f.path !== selectedAsset.path);
            setAssets(updated);
            await setRepoAssetCache(repoPath, updated);
            showToast(`${selectedAsset.name} deleted`, 'success');
        } catch (e: any) {
            showToast(`Delete failed: ${e.message}`, 'error');
        } finally {
            setIsLoading(false);
            setIsDeleteVisible(false);
            setSelectedAsset(null);
        }
    }, [selectedAsset, repoPath, assets, setRepoAssetCache, showToast]);

    const handleRenameAsset = async (newName: string) => {
        if (!selectedAsset || !newName || !repoPath || !repoConfig) return;
        const ext = selectedAsset.name.split('.').pop();
        const cleanName = newName.includes('.') ? newName : `${newName}.${ext}`;

        const oldAsset = { ...selectedAsset };
        const previousAssets = [...assets];
        const parentDir = oldAsset.path.includes('/') ? oldAsset.path.substring(0, oldAsset.path.lastIndexOf('/')) : '';
        const newPath = parentDir ? `${parentDir}/${cleanName}`.replace(/\/+/g, '/') : cleanName;

        // Optimistically update UI
        const optimisticAssets = assets.map(a => a.path === oldAsset.path ? { ...a, name: cleanName, path: newPath } : a);
        setAssets(optimisticAssets);
        setIsRenameVisible(false);

        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const contentRes = await axios.get(`https://api.github.com/repos/${repoPath}/contents/${oldAsset.path}`, {
                headers: { Authorization: `token ${token}` }
            });
            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, {
                message: `fix!(assets): renamed ${oldAsset.name}`,
                content: contentRes.data.content,
            }, { headers: { Authorization: `token ${token}` } });
            await axios.delete(`https://api.github.com/repos/${repoPath}/contents/${oldAsset.path}`, {
                headers: { Authorization: `token ${token}` },
                data: { message: `fix!(assets): cleaned up after rename`, sha: oldAsset.sha }
            });
            await setRepoAssetCache(repoPath, optimisticAssets);
            showToast(`Renamed to ${cleanName}`, 'success');
        } catch (e: any) {
            console.error('[Files] Rename asset failed', e);
            // Revert on failure
            setAssets(previousAssets);
            showToast(`Rename failed: ${e.message}`, 'error');
        } finally {
            setSelectedAsset(null);
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

    const confirmAssetUpload = useCallback(async (name: string) => {
        if (!lastPickedUri || !name || !repoPath || !repoConfig) return;
        setIsImageNameVisible(false);
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            const finalName = name.endsWith(`.${pickedAssetExtension}`) ? name : `${name}.${pickedAssetExtension}`;

            const cleanStatic = repoConfig.useStaticFolder !== false ? (repoConfig.staticDir?.replace(/^\/+|\/+$/g, '') || '') : '';
            const cleanAssets = repoConfig.assetsDir?.replace(/^\/+|\/+$/g, '') || '';
            const fullAssetsPath = [cleanStatic, cleanAssets].filter(Boolean).join('/');
            const newPath = `${fullAssetsPath}/${finalName}`.replace(/^\/+/, '').replace(/\/+/g, '/');

            const resp = await fetch(lastPickedUri);
            const blob = await resp.blob();
            const base64: string = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const res = reader.result as string;
                    resolve(res.split(',')[1]);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            await axios.put(`https://api.github.com/repos/${repoPath}/contents/${newPath}`, {
                message: `add!(assets): uploaded asset ${finalName}`,
                content: base64
            }, {
                headers: { Authorization: `token ${token}` }
            });

            showToast('Asset uploaded', 'success');
            fetchAssets(true);
        } catch (e: any) {
            showToast(`Upload failed: ${e.message}`, 'error');
        } finally {
            setIsLoading(false);
            setLastPickedUri(null);
            setPickedFilename('');
        }
    }, [lastPickedUri, pickedAssetType, repoPath, repoConfig, fetchAssets, showToast]);

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

    const isEditableFile = useCallback((name: string) => {
        return /\.(md|markdown|txt|json|yaml|yml|toml|html|css|js|ts|tsx|jsx|xml|csv|ini|cfg|conf|sh|bash|zsh|py|rb|go|rs|java|kt|c|cpp|h|hpp|gitignore|env|log)$/i.test(name) || !name.includes('.');
    }, []);

    const renderPostItem = useCallback(({ item }: any) => {
        if (item._isDir) {
            return (
                <DirItem
                    item={item}
                    onPress={() => handleDirPress(item.name)}
                    onRename={() => { setSelectedFile(item); setIsRenameVisible(true); }}
                    onDelete={() => { setSelectedFile(item); setIsDeleteVisible(true); }}
                />
            );
        }
        const canEdit = isEditableFile(item.name);
        return (
            <FileItem
                item={item}
                onPress={canEdit
                    ? () => router.push(`/editor/${encodeURIComponent(item.path)}`)
                    : () => { showToast(`Cannot edit binary file: ${item.name}`, 'info'); }
                }
                onRename={() => { setSelectedFile(item); setIsRenameVisible(true); }}
                onDelete={() => { setSelectedFile(item); setIsDeleteVisible(true); }}
            />
        );
    }, [router, handleDirPress, handleNavigateUp, isEditableFile, showToast]);

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
        let filtered = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()) && !tombstones.has(f.path));
        // Apply file visibility settings
        if (!repoConfig?.showAdvancedFiles) {
            // Only show markdown files and directories, and hide dotfiles
            filtered = filtered.filter(f => (f._isDir || f.name.match(/\.(md|markdown)$/i)) && !f.name.startsWith('.'));
        }
        // Sort: directories first (alphabetical), then files
        const dirs = filtered.filter(f => f._isDir).sort((a: any, b: any) => a.name.localeCompare(b.name));
        const posts = filtered.filter(f => !f._isDir);
        const result = [...dirs, ...posts];
        return result;
    }, [files, searchQuery, tombstones, currentDir, repoConfig?.showAdvancedFiles]);
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
                <View>
                    <Button
                        icon="cog-outline"
                        mode="text"
                        compact
                        onPress={() => router.push('/config?from=dashboard')}
                        onLongPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                            router.push('/advanced-files');
                        }}
                        style={{ marginRight: 12 }}
                    >
                        Settings
                    </Button>
                </View>
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
                <SlidingTabContainer selectedIndex={selectedIndex}>
                    {/* Posts Tab */}
                    <View style={{ flex: 1 }}>
                        <FlatList
                            data={filteredFiles}
                            keyExtractor={postKeyExtractor}
                            contentContainerStyle={styles.draftList}
                            refreshControl={
                                <RefreshControl
                                    refreshing={isRefreshing && mode === 'posts'}
                                    onRefresh={handleRefreshPosts}
                                    colors={[theme.colors.primary]}
                                    progressBackgroundColor={theme.colors.surface}
                                />
                            }
                            renderItem={renderPostItem}
                            ListFooterComponent={
                                (isLoading && filteredFiles.length > 0) ? (
                                    <ListingSkeleton />
                                ) : null
                            }
                            ListEmptyComponent={
                                isLoading ? (
                                    <ListingSkeleton />
                                ) : (hasLoadedPosts ? (
                                    <View style={styles.emptyState}>
                                        <Avatar.Icon size={64} icon="file-search-outline" style={{ backgroundColor: 'transparent' }} color={theme.colors.outline} />
                                        <Text variant="bodyLarge" style={{ color: theme.colors.outline, marginTop: 16 }}>No posts found.</Text>
                                    </View>
                                ) : null)
                            }
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
                            contentContainerStyle={styles.assetList}
                            refreshControl={
                                <RefreshControl
                                    refreshing={isRefreshing && mode === 'assets'}
                                    onRefresh={handleRefreshAssets}
                                    colors={[theme.colors.primary]}
                                    progressBackgroundColor={theme.colors.surface}
                                />
                            }
                            renderItem={null}
                            ListHeaderComponent={
                                filteredAssets.length > 0 ? (
                                    <View style={styles.assetRow}>
                                        <View style={styles.assetColumn}>
                                            {filteredAssets.filter((_, i) => i % 2 === 0).map(item => (
                                                <AssetItem
                                                    key={item.path}
                                                    item={item}
                                                    headers={githubToken ? { Authorization: `token ${githubToken}` } : {}}
                                                    onRename={() => { setSelectedAsset(item); setIsRenameVisible(true); }}
                                                    onDelete={() => { setSelectedAsset(item); setIsDeleteVisible(true); }}
                                                />
                                            ))}
                                            {isLoading && [1, 2, 3].map(i => <SkeletonItem key={`sk1-${i}`} isGrid />)}
                                        </View>
                                        <View style={styles.assetColumn}>
                                            {filteredAssets.filter((_, i) => i % 2 !== 0).map(item => (
                                                <AssetItem
                                                    key={item.path}
                                                    item={item}
                                                    headers={githubToken ? { Authorization: `token ${githubToken}` } : {}}
                                                    onRename={() => { setSelectedAsset(item); setIsRenameVisible(true); }}
                                                    onDelete={() => { setSelectedAsset(item); setIsDeleteVisible(true); }}
                                                />
                                            ))}
                                            {isLoading && (filteredAssets.length % 2 !== 0 ? [1, 2, 3, 4] : [1, 2, 3]).map(i => <SkeletonItem key={`sk2-${i}`} isGrid />)}
                                        </View>
                                    </View>
                                ) : null
                            }
                            ListFooterComponent={null}
                            ListEmptyComponent={
                                isLoading ? (
                                    <ListingSkeleton isGrid />
                                ) : (hasLoadedAssets ? (
                                    <View style={styles.emptyState}>
                                        <Avatar.Icon size={64} icon="image-off-outline" style={{ backgroundColor: 'transparent' }} color={theme.colors.outline} />
                                        <Text variant="bodyLarge" style={{ color: theme.colors.outline, marginTop: 16 }}>No assets found.</Text>
                                    </View>
                                ) : null)
                            }
                        />
                    </View>
                </SlidingTabContainer>
            </View>

            <Portal>
                <NewFileDialog
                    visible={isNewFileVisible}
                    onDismiss={() => setIsNewFileVisible(false)}
                    onCreate={handleCreateFile}
                    title="New Post"
                    label="Filename"
                />

                <NewDraftDialog
                    visible={isNewDraftVisible}
                    onDismiss={() => setIsNewDraftVisible(false)}
                    onCreate={handleCreateDraft}
                    title="New Draft"
                    repoPath={repoPath}
                    repoConfig={repoConfig}
                />

                <AssetTypeDialog
                    visible={isAssetTypeVisible}
                    onDismiss={() => setIsAssetTypeVisible(false)}
                    onSelect={handlePickAsset}
                />

                <ImageNameDialog
                    visible={isImageNameVisible}
                    onDismiss={() => setIsImageNameVisible(false)}
                    onConfirm={confirmAssetUpload}
                    initialValue={pickedFilename}
                    extension={pickedAssetExtension}
                    size={pickedAssetSize}
                />

                <RenameDialog
                    visible={isRenameVisible}
                    onDismiss={() => setIsRenameVisible(false)}
                    onRename={mode === 'assets' ? handleRenameAsset : handleRenameFile}
                    initialValue={mode === 'assets' ? (selectedAsset?.name?.split('.')[0] || '') : (selectedFile?.name?.replace('.md', '') || '')}
                    title={mode === 'assets' ? 'Rename Asset' : (selectedFile?._isDir ? 'Rename Directory' : 'Rename Post')}
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
                    <Dialog.Icon icon="alert-circle-outline" color={theme.colors.error} />
                    <Dialog.Title style={{ textAlign: 'center' }}>
                        {mode === 'assets' ? 'Delete Asset?' : selectedFile?._isDir ? 'Delete Directory?' : 'Delete Post?'}
                    </Dialog.Title>
                    <Dialog.Content>
                        <Text style={{ textAlign: 'center' }}>
                            Are you sure you want to delete <Text style={{ fontWeight: 'bold' }}>{mode === 'assets' ? selectedAsset?.name : selectedFile?.name}</Text>?
                            {selectedFile?._isDir ? '\n\nWARNING: This will recursively delete ALL files inside. This action cannot be undone.' : ' This action cannot be undone.'}
                        </Text>
                        {selectedFile?._isDir && (
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
                                    if (selectedFile?._isDir) {
                                        showToast('Long-press to confirm folder deletion', 'info');
                                    } else {
                                        if (mode === 'assets') handleDeleteAsset();
                                        else handleDeleteFile();
                                    }
                                }}
                                onLongPress={() => {
                                    if (selectedFile?._isDir) {
                                        handleDeleteFile();
                                    }
                                }}
                                textColor={theme.colors.error}
                            >
                                Delete
                            </Button>
                        </View>
                    </Dialog.Actions>
                </Dialog>
                <Dialog visible={isDeleteDraftVisible} onDismiss={() => setIsDeleteDraftVisible(false)} style={{ borderRadius: 28 }}>
                    <Dialog.Icon icon="alert-circle-outline" color={theme.colors.error} />
                    <Dialog.Title style={{ textAlign: 'center' }}>Delete Draft?</Dialog.Title>
                    <Dialog.Content>
                        <Text style={{ textAlign: 'center' }}>Are you sure you want to delete draft <Text style={{ fontWeight: 'bold' }}>{selectedDraft?.title}</Text>? This action cannot be undone.</Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setIsDeleteDraftVisible(false)}>Cancel</Button>
                        <Button
                            onPress={async () => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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

            <View style={styles.fabContainer}>
                <FAB
                    icon={mode === 'posts' ? 'file-document-outline' : mode === 'drafts' ? 'pencil-box-outline' : 'file-plus-outline'}
                    label={mode === 'posts' ? 'New Post' : mode === 'drafts' ? 'New Draft' : 'New Asset'}
                    style={styles.fabContent}
                    onPress={handleAction}
                />
                <View style={{ alignItems: 'center', gap: 12 }}>
                    {currentDir !== '' && mode === 'posts' && (
                        <FAB
                            icon="arrow-left"
                            style={[styles.fabContent, { backgroundColor: theme.colors.surfaceVariant }]}
                            onPress={handleNavigateUp}
                        />
                    )}
                    <FAB
                        icon="web"
                        style={styles.fabContent}
                        onPress={() => {
                            if (repoConfig?.siteUrl) {
                                Linking.openURL(repoConfig.siteUrl);
                            } else {
                                Linking.openURL(`https://github.com/${repoPath}`);
                            }
                        }}
                        onLongPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            Linking.openURL(`https://github.com/${repoPath}`);
                        }}
                    />
                </View>
            </View>
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
    fabContainer: {
        position: 'absolute',
        right: 16,
        bottom: 16,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 12,
    },
    fabContent: {
        elevation: 4,
    },
    tabContainer: {
        paddingBottom: 8,
    },
    assetList: {
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
