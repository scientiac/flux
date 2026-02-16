import axios from 'axios';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Appbar, Avatar, FAB, List, Searchbar, Text, useTheme } from 'react-native-paper';
import { useAppContext } from '../context/AppContext';

export default function Files() {
    const { config } = useAppContext();
    const theme = useTheme();
    const router = useRouter();

    const [files, setFiles] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const fetchFiles = async () => {
        if (!config.repo) return;
        setIsLoading(true);
        try {
            const token = await SecureStore.getItemAsync('github_access_token');
            if (!token) throw new Error('Not authenticated');

            const response = await axios.get(`https://api.github.com/repos/${config.repo}/contents/${config.contentDir}`, {
                headers: { Authorization: `token ${token}` }
            });

            // Filter for markdown files
            if (Array.isArray(response.data)) {
                const mdFiles = response.data.filter((f: any) =>
                    f.type === 'file' && (f.name.endsWith('.md') || f.name.endsWith('.markdown'))
                );
                setFiles(mdFiles);
            } else {
                setFiles([]);
            }
        } catch (e: any) {
            console.error('[Files] Fetch failed', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchFiles();
    }, [config.repo, config.contentDir]);

    const filteredFiles = files.filter(f =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header elevated style={{ backgroundColor: theme.colors.surface }}>
                <Appbar.BackAction onPress={() => router.push('/')} />
                <Appbar.Content title="Posts" titleStyle={{ fontWeight: 'bold' }} subtitle={config.repo} />
                <Appbar.Action icon="cog" onPress={() => router.push('/config')} />
            </Appbar.Header>

            <View style={styles.content}>
                <Searchbar
                    placeholder="Search posts..."
                    onChangeText={setSearchQuery}
                    value={searchQuery}
                    style={styles.searchbar}
                    icon="filter-variant"
                />

                <FlatList
                    data={filteredFiles}
                    keyExtractor={(item) => item.sha}
                    contentContainerStyle={{ paddingBottom: 80 }}
                    refreshControl={
                        <RefreshControl
                            refreshing={isLoading}
                            onRefresh={fetchFiles}
                            colors={[theme.colors.primary]}
                            progressBackgroundColor={theme.colors.surfaceVariant}
                        />
                    }
                    renderItem={({ item }) => (
                        <List.Item
                            title={item.name}
                            titleStyle={{ fontWeight: '600' }}
                            description={`Path: ${item.path}`}
                            descriptionStyle={{ opacity: 0.6 }}
                            left={props => <List.Icon {...props} icon="file-document-outline" color={theme.colors.primary} />}
                            right={props => <List.Icon {...props} icon="chevron-right" />}
                            onPress={() => {
                                // Dynamic routing with fragments requires encoding
                                router.push(`/editor/${encodeURIComponent(item.path)}`);
                            }}
                            style={styles.listItem}
                        />
                    )}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Avatar.Icon size={64} icon="file-search-outline" style={{ backgroundColor: 'transparent' }} color={theme.colors.outline} />
                            <Text variant="bodyLarge" style={{ color: theme.colors.outline, marginTop: 16 }}>
                                No posts found in this directory.
                            </Text>
                        </View>
                    }
                />
            </View>

            <FAB
                icon="plus"
                label="New Post"
                style={styles.fab}
                onPress={() => router.push('/editor/new')}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { flex: 1 },
    searchbar: { margin: 16, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.02)' },
    listItem: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.05)' },
    emptyState: { flex: 1, padding: 64, alignItems: 'center', justifyContent: 'center' },
    fab: {
        position: 'absolute',
        margin: 16,
        right: 0,
        bottom: 0,
        borderRadius: 16,
    },
});
