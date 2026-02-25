import axios from 'axios';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Dialog, HelperText, Portal, Snackbar, Switch, Text, TextInput, useTheme } from 'react-native-paper';
import { useAppContext } from '../context/AppContext';

export default function Config() {
    const { config, updateRepoConfig, removeRepoConfig } = useAppContext();
    const theme = useTheme();
    const router = useRouter();
    const { from } = useLocalSearchParams();

    const repoPath = config.repo;
    const currentRepoConfig = repoPath ? config.repoConfigs[repoPath] : null;

    const [contentDir, setContentDir] = useState(currentRepoConfig?.contentDir || 'content/posts');
    const [useStaticFolder, setUseStaticFolder] = useState(currentRepoConfig?.useStaticFolder ?? true);
    const [staticDir, setStaticDir] = useState(currentRepoConfig?.staticDir || 'static');
    const [assetsDir, setAssetsDir] = useState(currentRepoConfig?.assetsDir || 'assets');
    const [postTemplate, setPostTemplate] = useState(currentRepoConfig?.postTemplate || "+++\ntitle: {{title}}\ndate: {{date}}\ntime: {{time}}\n+++\n\n");
    const [siteUrl, setSiteUrl] = useState(currentRepoConfig?.siteUrl || '');
    const [isValidating, setIsValidating] = useState(false);

    // Remove confirmation dialog
    const [removeDialogVisible, setRemoveDialogVisible] = useState(false);

    // Snackbar
    const [snackbarVisible, setSnackbarVisible] = useState(false);
    const [snackbarMsg, setSnackbarMsg] = useState('');

    useEffect(() => {
        if (currentRepoConfig) {
            setContentDir(currentRepoConfig.contentDir);
            setUseStaticFolder(currentRepoConfig.useStaticFolder ?? true);
            if (currentRepoConfig.staticDir !== undefined) setStaticDir(currentRepoConfig.staticDir);
            setAssetsDir(currentRepoConfig.assetsDir);
            if (currentRepoConfig.postTemplate) setPostTemplate(currentRepoConfig.postTemplate);
            setSiteUrl(currentRepoConfig.siteUrl || '');
        }
    }, [currentRepoConfig]);

    const validateAndSave = useCallback(async () => {
        if (!repoPath) return;
        setIsValidating(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            if (!token) throw new Error('Not authenticated');

            // Sanitize: strip trailing slashes to prevent // in paths
            const cleanContentDir = contentDir.replace(/^\/+|\/+$/g, '');
            const cleanStaticDir = staticDir.replace(/^\/+|\/+$/g, '');
            const cleanAssetsDir = assetsDir.replace(/^\/+|\/+$/g, '');

            // 1. Ensure folders exist or create them
            const dirs = [cleanContentDir];
            if (useStaticFolder && cleanStaticDir && cleanAssetsDir) {
                dirs.push(`${cleanStaticDir}/${cleanAssetsDir}`.replace(/\/+/g, '/'));
            } else if (useStaticFolder && cleanStaticDir) {
                dirs.push(cleanStaticDir);
            } else if (cleanAssetsDir) {
                dirs.push(cleanAssetsDir);
            }
            for (const dir of dirs) {
                try {
                    await axios.get(`https://api.github.com/repos/${repoPath}/contents/${dir}`, {
                        headers: { Authorization: `token ${token}` }
                    });
                } catch (e: any) {
                    if (e.response?.status === 404) {
                        // Create placeholder to initialize folder
                        await axios.put(`https://api.github.com/repos/${repoPath}/contents/${dir}/.gitkeep`, {
                            message: `Initialize ${dir}`,
                            content: 'Ym9vdHN0cmFw', // "bootstrap" in base64
                        }, {
                            headers: { Authorization: `token ${token}` }
                        });
                    } else {
                        throw e;
                    }
                }
            }

            await updateRepoConfig(repoPath, {
                contentDir: cleanContentDir,
                useStaticFolder,
                staticDir: cleanStaticDir,
                assetsDir: cleanAssetsDir,
                postTemplate: postTemplate,
                siteUrl: siteUrl.trim()
            });
            setSnackbarMsg('Settings saved successfully');
            setSnackbarVisible(true);
            setTimeout(() => {
                if (from === 'dashboard') router.back();
                else router.replace('/files');
            }, 1000);
        } catch (e: any) {
            setSnackbarMsg(e.message || 'Validation failed');
            setSnackbarVisible(true);
        } finally {
            setIsValidating(false);
        }
    }, [repoPath, contentDir, useStaticFolder, staticDir, assetsDir, postTemplate, siteUrl, updateRepoConfig, from, router]);

    const handleRemoveSite = useCallback(async () => {
        if (!repoPath) return;
        setRemoveDialogVisible(false);
        await removeRepoConfig(repoPath);
        setSnackbarMsg('Site removed from Flux');
        setSnackbarVisible(true);
        setTimeout(() => router.replace('/'), 800);
    }, [repoPath, removeRepoConfig, setSnackbarMsg, setSnackbarVisible, router]);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header elevated={false} style={{ backgroundColor: theme.colors.background }}>
                <Appbar.BackAction onPress={() => router.back()} />
                <Appbar.Content title="Site Settings" titleStyle={{ fontWeight: 'bold' }} />
                {currentRepoConfig && (
                    <Button
                        icon="delete-outline"
                        mode="text"
                        onPress={() => setRemoveDialogVisible(true)}
                        textColor={theme.colors.error}
                        compact
                    >
                        Remove
                    </Button>
                )}
                <Button
                    icon="content-save-outline"
                    mode="text"
                    onPress={validateAndSave}
                    disabled={isValidating || !contentDir}
                    loading={isValidating}
                    compact
                    style={{ marginRight: 12 }}
                >
                    Save
                </Button>
            </Appbar.Header>

            <ScrollView contentContainerStyle={styles.content}>
                <Text variant="bodyMedium" style={[styles.subtitle, { color: theme.colors.outline }]}>
                    Settings for <Text style={{ fontWeight: 'bold', color: theme.colors.onBackground }}>{repoPath}</Text>
                </Text>

                <View style={styles.inputGroup}>
                    <TextInput
                        label="Site URL"
                        value={siteUrl}
                        onChangeText={setSiteUrl}
                        mode="flat"
                        placeholder="e.g. https://example.com"
                        keyboardType="url"
                        autoCapitalize="none"
                        style={[styles.capsuleInput, { backgroundColor: theme.colors.surfaceVariant }]}
                        selectionColor={theme.colors.primary}
                        activeUnderlineColor={theme.colors.primary}
                        left={<TextInput.Icon icon="web" />}
                    />
                    <HelperText type="info">Your site's public URL. Used for quick access from the dashboard.</HelperText>
                </View>

                <View style={styles.inputGroup}>
                    <TextInput
                        label="Posts Directory"
                        value={contentDir}
                        onChangeText={setContentDir}
                        mode="flat"
                        placeholder="e.g. content/posts"
                        style={[styles.capsuleInput, { backgroundColor: theme.colors.surfaceVariant }]}
                        selectionColor={theme.colors.primary}
                        activeUnderlineColor={theme.colors.primary}
                        left={<TextInput.Icon icon="folder-outline" />}
                    />
                    <HelperText type="info">Where your markdown files are stored.</HelperText>
                </View>

                <View style={[styles.inputGroup, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }]}>
                    <View style={{ flex: 1, paddingRight: 16 }}>
                        <Text variant="titleMedium" style={{ color: theme.colors.onBackground, fontWeight: '600' }}>Use Static Directory</Text>
                        <Text variant="bodySmall" style={{ color: theme.colors.outline, marginTop: 4 }}>
                            Separate content and assets using a framework-like static directory (e.g., Next.js, Zola). Disable for flat Markdown folders (e.g., Obsidian).
                        </Text>
                    </View>
                    <Switch value={useStaticFolder} onValueChange={setUseStaticFolder} />
                </View>

                {useStaticFolder && (
                    <View style={styles.inputGroup}>
                        <TextInput
                            label="Static Directory"
                            value={staticDir}
                            onChangeText={setStaticDir}
                            mode="flat"
                            placeholder="e.g. static"
                            style={[styles.capsuleInput, { backgroundColor: theme.colors.surfaceVariant }]}
                            selectionColor={theme.colors.primary}
                            activeUnderlineColor={theme.colors.primary}
                            left={<TextInput.Icon icon="folder-home-outline" />}
                        />
                        <HelperText type="info">The root directory for static files (e.g. 'static' for Zola).</HelperText>
                    </View>
                )}

                <View style={styles.inputGroup}>
                    <TextInput
                        label={useStaticFolder ? "Assets Directory (relative to Static)" : "Assets Directory (relative to root)"}
                        value={assetsDir}
                        onChangeText={setAssetsDir}
                        mode="flat"
                        placeholder="e.g. assets"
                        style={[styles.capsuleInput, { backgroundColor: theme.colors.surfaceVariant }]}
                        selectionColor={theme.colors.primary}
                        activeUnderlineColor={theme.colors.primary}
                        left={<TextInput.Icon icon="image-outline" />}
                    />
                    <HelperText type="info">Where images will be placed. Markdown links will use this path.</HelperText>
                </View>

                <View style={styles.inputGroup}>
                    <TextInput
                        label="Post Frontmatter Template"
                        value={postTemplate}
                        onChangeText={setPostTemplate}
                        mode="flat"
                        multiline
                        numberOfLines={10}
                        placeholder="---\ntitle: {{title}}\n---"
                        style={[styles.capsuleInput, { backgroundColor: theme.colors.surfaceVariant, minHeight: 180, paddingVertical: 8 }]}
                        selectionColor={theme.colors.primary}
                        activeUnderlineColor={theme.colors.primary}
                        left={<TextInput.Icon icon="file-document-edit-outline" style={{ marginTop: 8 }} />}
                    />
                    <HelperText type="info">Defines the frontmatter for new posts. Use {'{{title}}'}, {'{{date}}'} and {'{{time}}'} as placeholders.</HelperText>
                </View>


            </ScrollView>

            <Portal>
                <Dialog visible={removeDialogVisible} onDismiss={() => setRemoveDialogVisible(false)} style={{ borderRadius: 28 }}>
                    <Dialog.Icon icon="alert-circle-outline" color={theme.colors.error} />
                    <Dialog.Title style={{ textAlign: 'center' }}>Remove Site?</Dialog.Title>
                    <Dialog.Content>
                        <Text variant="bodyMedium" style={{ textAlign: 'center' }}>
                            This will remove <Text style={{ fontWeight: 'bold' }}>{repoPath}</Text> from your configured sites, including its cached data and local drafts. This does not delete anything from GitHub.
                        </Text>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setRemoveDialogVisible(false)}>Cancel</Button>
                        <Button onPress={handleRemoveSite} textColor={theme.colors.error}>Remove</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            <Snackbar
                visible={snackbarVisible}
                onDismiss={() => setSnackbarVisible(false)}
                duration={3000}
                style={{ backgroundColor: theme.colors.secondaryContainer, borderRadius: 12 }}
            >
                <Text style={{ color: theme.colors.onSecondaryContainer }}>{snackbarMsg}</Text>
            </Snackbar>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { padding: 24, paddingBottom: 48 },
    subtitle: { marginBottom: 24 },
    inputGroup: { marginBottom: 16 },
    capsuleInput: {
        backgroundColor: 'rgba(0,0,0,0.03)',
    },
});

